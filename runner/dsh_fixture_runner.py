#!/usr/bin/env python3
"""Pinned miniwdl 1.15.0 entrypoint for dsh-bio-workflows isolated fixture tests.

This module intentionally uses miniwdl's version-pinned TaskContainer extension point. It is
invoked with an explicit Python interpreter by the Node control plane and is never installed as a
global miniwdl backend.
"""

from __future__ import annotations

import contextlib
import configparser
import ctypes
import errno
import fcntl
import hashlib
import importlib
import importlib.metadata
import json
import logging
import math
import os
import re
import resource
import selectors
import signal
import socket
import stat
import subprocess
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple


POLICY_VERSION = "1"
BACKEND_NAME = "dsh_fixture_docker"
EXPECTED_MINIWDL_VERSION = "1.15.0"
CONTROLLER_NETWORK_POLICY = "seccomp_deny_non_unix_sockets_before_wdl_load"
PINNED_IMAGE = re.compile(r"^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$")
SAFE_HOST_PATH = re.compile(r"^/[A-Za-z0-9_./:+@=-]+$")
SAFE_CONTAINER_PATH = re.compile(r"^/[A-Za-z0-9_./:+@=-]+$")
MAX_DOCKER_OUTPUT_BYTES = 256 * 1024
MAX_EVIDENCE_BYTES = 2 * 1024 * 1024
MAX_WDL_SOURCE_BYTES = 1024 * 1024
DOCKER_BROKER_VIRTUAL_ADDRESS_SPACE_BYTES = 4 * 1024 * 1024 * 1024
DOCKER_BROKER_ADDITIONAL_PROCESSES = 128
MAX_BROKER_MESSAGE_BYTES = 4 * 1024 * 1024
CONTAINER_ROOT = "/mnt/miniwdl_task_container"
TOKEN_LABEL = "dsh.fixture.token"
OWNER_LABEL = "dsh.fixture.owner"
TEST_ID_LABEL = "dsh.fixture.test-id"
PLAN_DIGEST_LABEL = "dsh.fixture.plan-digest"
OWNER_LABEL_VALUE = "dsh-bio-workflows"
TEST_ID = re.compile(
    r"^test-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
FIXED_CONTAINER_ENVIRONMENT = {
    "HOME": "/tmp/home",
    "TMPDIR": "/tmp",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
}
FIXED_CONTROLLER_ENVIRONMENT = {
    "HOME": "$RUN/controller-home",
    "TMPDIR": "/tmp",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
}
ENVIRONMENT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
MIN_BUDGETS = {
    "cpu": 1,
    "memory_bytes": 64 * 1024 * 1024,
    "pids": 8,
    "task_time_ms": 5_000,
    "log_bytes": 4 * 1024,
    "artifact_count": 1,
    "artifact_bytes": 4 * 1024,
    "total_output_bytes": 4 * 1024,
    "task_count": 1,
}
MAX_BUDGETS = {
    "cpu": 4,
    "memory_bytes": 4 * 1024 * 1024 * 1024,
    "pids": 512,
    "task_time_ms": 10 * 60 * 1_000,
    "log_bytes": 4 * 1024 * 1024,
    "artifact_count": 1024,
    "artifact_bytes": 64 * 1024 * 1024,
    "total_output_bytes": 256 * 1024 * 1024,
    "task_count": 64,
}

_ORIGINAL_SOCKET_CONNECT = socket.socket.connect
_ORIGINAL_SOCKET_CONNECT_EX = socket.socket.connect_ex
_ORIGINAL_GETADDRINFO = socket.getaddrinfo
_NETWORK_GUARD_INSTALLED = False
_MEMORY_WATCHDOG: Optional[threading.Thread] = None
_HOST_CANARY: Optional["HostCanary"] = None
_SITE_PACKAGES: Optional[str] = None
_BOOTSTRAP_GUARD: Optional[Dict[str, Any]] = None
_CONTROLLER_BASIS: Optional[Dict[str, Any]] = None
_DOCKER_BROKER_SOCKET: Optional[socket.socket] = None
_DOCKER_BROKER_PID: Optional[int] = None
_DOCKER_BROKER_LOCK = threading.Lock()


class _SockFilter(ctypes.Structure):
    _fields_ = [
        ("code", ctypes.c_ushort),
        ("jt", ctypes.c_ubyte),
        ("jf", ctypes.c_ubyte),
        ("k", ctypes.c_uint32),
    ]


class _SockFprog(ctypes.Structure):
    _fields_ = [
        ("length", ctypes.c_ushort),
        ("filter", ctypes.POINTER(_SockFilter)),
    ]


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def digest(value: Any, domain: str) -> str:
    hasher = hashlib.sha256()
    hasher.update(f"dsh-bio-fixture-runner-{domain}-v1\n".encode("utf-8"))
    hasher.update(stable_json(value).encode("utf-8"))
    return "sha256:" + hasher.hexdigest()


def file_sha256(path: str) -> Tuple[str, int]:
    metadata = os.lstat(path)
    if not stat.S_ISREG(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RunnerError("Python runtime environment contains an unsupported distribution file")
    hasher = hashlib.sha256()
    size = 0
    with open(path, "rb", buffering=0) as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > 256 * 1024 * 1024:
                raise RunnerError("Python runtime distribution file exceeds its identity limit")
            hasher.update(chunk)
    return "sha256:" + hasher.hexdigest(), size


def canonical_distribution_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def requirement_name(value: str) -> Optional[str]:
    if "extra ==" in value or "extra==" in value:
        return None
    match = re.match(r"^\s*([A-Za-z0-9][A-Za-z0-9_.-]*)", value)
    return None if match is None else canonical_distribution_name(match.group(1))


def isolated_site_packages() -> Tuple[str, str]:
    if not (
        sys.flags.isolated == 1
        and sys.flags.no_site == 1
        and sys.flags.ignore_environment == 1
        and sys.flags.no_user_site == 1
    ):
        raise RunnerError("isolated fixture runner requires Python -I -S startup")
    executable = os.path.abspath(sys.executable)
    environment_root = os.path.dirname(os.path.dirname(executable))
    candidate = os.path.join(
        environment_root,
        "lib",
        f"python{sys.version_info.major}.{sys.version_info.minor}",
        "site-packages",
    )
    canonical = os.path.realpath(candidate)
    if canonical != candidate:
        raise RunnerError("miniwdl site-packages path contains a symbolic link")
    metadata = os.lstat(canonical)
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        raise RunnerError("miniwdl site-packages path is not a concrete directory")
    return canonical, os.path.realpath(environment_root)


def distribution_lookup(site_packages: str) -> Dict[str, importlib.metadata.Distribution]:
    found: Dict[str, importlib.metadata.Distribution] = {}
    for distribution in importlib.metadata.distributions(path=[site_packages]):
        name = distribution.metadata.get("Name")
        if not isinstance(name, str) or not name:
            raise RunnerError("Python runtime distribution has no canonical name")
        canonical_name = canonical_distribution_name(name)
        if canonical_name in found:
            raise RunnerError("Python runtime contains duplicate dependency distributions")
        found[canonical_name] = distribution
        if len(found) > 4096:
            raise RunnerError("Python runtime distribution inventory exceeds its bound")
    return found


def python_environment_identity(site_packages: Optional[str] = None) -> Dict[str, Any]:
    if site_packages is None:
        site_packages, environment_root = isolated_site_packages()
    else:
        environment_root = os.path.realpath(os.path.join(site_packages, "../../.."))
    available = distribution_lookup(site_packages)
    queue = ["miniwdl"]
    seen = set()
    distributions: List[Dict[str, Any]] = []
    while queue:
        requested = queue.pop(0)
        canonical_name = canonical_distribution_name(requested)
        if canonical_name in seen:
            continue
        distribution = available.get(canonical_name)
        if distribution is None:
            raise RunnerError(
                "Python runtime dependency is missing from the miniwdl environment: " + requested
            )
        seen.add(canonical_name)
        requirements = distribution.requires or []
        for requirement in requirements:
            dependency = requirement_name(requirement)
            if dependency is None or dependency in seen:
                continue
            if dependency in available:
                queue.append(dependency)

        files = []
        total_bytes = 0
        for item in sorted(distribution.files or [], key=lambda candidate: str(candidate)):
            relative_path = str(item).replace(os.sep, "/")
            if relative_path.endswith((".pyc", ".pyo")) or "/__pycache__/" in f"/{relative_path}/":
                continue
            located = os.path.realpath(str(distribution.locate_file(item)))
            try:
                contained = os.path.commonpath((environment_root, located)) == environment_root
            except ValueError:
                contained = False
            if not contained:
                raise RunnerError("Python runtime distribution file escaped its environment")
            if not os.path.exists(located):
                raise RunnerError("Python runtime distribution identity contains a missing file")
            file_digest, size = file_sha256(located)
            total_bytes += size
            files.append({"path": relative_path, "sizeBytes": size, "sha256": file_digest})
            if len(files) > 8192 or total_bytes > 256 * 1024 * 1024:
                raise RunnerError("Python runtime distribution identity exceeds its bounds")
        basis = {
            "name": canonical_distribution_name(distribution.metadata["Name"]),
            "version": distribution.version,
            "files": files,
        }
        distributions.append(
            {
                "name": basis["name"],
                "version": basis["version"],
                "fileCount": len(files),
                "sizeBytes": total_bytes,
                "digest": digest(basis, "python-distribution"),
            }
        )
        if len(distributions) > 128:
            raise RunnerError("Python runtime dependency closure exceeds its bound")
    distributions.sort(key=lambda item: item["name"])
    startup_policy = {
        "mode": "python_isolated_no_site",
        "ignoreEnvironment": True,
        "noUserSite": True,
        "pthFilesExecuted": False,
        "sitecustomizeImported": False,
        "usercustomizeImported": False,
        "sitePackagesPathDigest": digest(site_packages, "site-packages-path"),
    }
    environment_basis = {
        "startupPolicy": startup_policy,
        "distributions": distributions,
    }
    return {
        "startupPolicy": startup_policy,
        "distributions": distributions,
        "environmentDigest": digest(environment_basis, "python-environment"),
    }


def controller_network_filter_identity() -> Dict[str, Any]:
    architecture = os.uname().machine
    supported = {
        "x86_64": {
            "auditArchitecture": "0xc000003e",
            "socketSyscall": 41,
            "seccompSyscall": 317,
        },
        "aarch64": {
            "auditArchitecture": "0xc00000b7",
            "socketSyscall": 198,
            "seccompSyscall": 277,
        },
    }
    if architecture not in supported:
        raise RunnerError("controller network seccomp filter does not support this architecture")
    basis = {
        "policy": CONTROLLER_NETWORK_POLICY,
        "architecture": architecture,
        **supported[architecture],
        "allowedSocketDomain": "AF_UNIX",
        "deniedAction": "errno:EPERM",
        "noNewPrivileges": True,
        "threadSynchronization": "SECCOMP_FILTER_FLAG_TSYNC",
    }
    return {**basis, "filterDigest": digest(basis, "controller-network-filter")}


def install_controller_network_seccomp(identity: Dict[str, Any]) -> None:
    # seccomp_data offsets from linux/seccomp.h: nr=0, arch=4, args[0]=16.
    bpf_ld_w_abs = 0x20
    bpf_jmp_jeq_k = 0x15
    bpf_ret_k = 0x06
    seccomp_ret_kill_process = 0x80000000
    seccomp_ret_errno = 0x00050000
    seccomp_ret_allow = 0x7FFF0000
    audit_architecture = int(identity["auditArchitecture"], 16)
    socket_syscall = identity["socketSyscall"]
    instructions = (_SockFilter * 9)(
        _SockFilter(bpf_ld_w_abs, 0, 0, 4),
        _SockFilter(bpf_jmp_jeq_k, 1, 0, audit_architecture),
        _SockFilter(bpf_ret_k, 0, 0, seccomp_ret_kill_process),
        _SockFilter(bpf_ld_w_abs, 0, 0, 0),
        _SockFilter(bpf_jmp_jeq_k, 0, 2, socket_syscall),
        _SockFilter(bpf_ld_w_abs, 0, 0, 16),
        _SockFilter(bpf_jmp_jeq_k, 0, 1, socket.AF_UNIX),
        _SockFilter(bpf_ret_k, 0, 0, seccomp_ret_allow),
        _SockFilter(bpf_ret_k, 0, 0, seccomp_ret_errno | errno.EPERM),
    )
    program = _SockFprog(len(instructions), instructions)
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong]
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(38, 1, None, 0, 0) != 0:  # PR_SET_NO_NEW_PRIVS
        raise RunnerError("controller no-new-privileges guard could not be installed")
    libc.syscall.argtypes = [ctypes.c_long, ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p]
    libc.syscall.restype = ctypes.c_long
    # seccomp(SECCOMP_SET_MODE_FILTER, SECCOMP_FILTER_FLAG_TSYNC, ...) atomically applies the
    # filter to the pre-existing host-canary thread and to every subsequently created thread.
    if libc.syscall(identity["seccompSyscall"], 1, 1, ctypes.byref(program)) != 0:
        system_error = ctypes.get_errno()
        raise RunnerError(
            "controller network seccomp filter could not be installed: "
            + os.strerror(system_error)
        )


def install_controller_network_guard() -> None:
    global _NETWORK_GUARD_INSTALLED
    if _NETWORK_GUARD_INSTALLED:
        return

    def guarded_connect(sock: socket.socket, address: Any) -> Any:
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            raise PermissionError(errno.EPERM, "isolated controller network access denied")
        return _ORIGINAL_SOCKET_CONNECT(sock, address)

    def guarded_connect_ex(sock: socket.socket, address: Any) -> int:
        if sock.family in (socket.AF_INET, socket.AF_INET6):
            return errno.EPERM
        return _ORIGINAL_SOCKET_CONNECT_EX(sock, address)

    def denied_name_resolution(*_args: Any, **_kwargs: Any) -> Any:
        raise PermissionError(errno.EPERM, "isolated controller name resolution denied")

    socket.socket.connect = guarded_connect  # type: ignore[assignment]
    socket.socket.connect_ex = guarded_connect_ex  # type: ignore[assignment]
    socket.getaddrinfo = denied_name_resolution  # type: ignore[assignment]
    socket.gethostbyname = denied_name_resolution  # type: ignore[assignment]
    socket.gethostbyname_ex = denied_name_resolution  # type: ignore[assignment]
    socket.gethostbyaddr = denied_name_resolution  # type: ignore[assignment]
    _NETWORK_GUARD_INSTALLED = True


def local_only_read_source_factory(
    wdl_root: str, exact_auxiliary_paths: Tuple[str, ...] = ()
) -> Callable[..., Any]:
    canonical_root = os.path.realpath(wdl_root)
    canonical_auxiliary = tuple(os.path.realpath(path) for path in exact_auxiliary_paths)

    async def read_source(uri: str, path: List[str], importer: Any) -> Any:
        if (
            not isinstance(uri, str)
            or not uri
            or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", uri)
        ):
            raise PermissionError("isolated fixture runner denied a non-local WDL import")
        if "\x00" in uri or "\\" in uri:
            raise PermissionError("isolated fixture runner denied an unsafe WDL import")
        if os.path.isabs(uri) and importer is not None:
            raise PermissionError("isolated fixture runner denied an absolute WDL import")
        bases: List[str]
        if os.path.isabs(uri):
            candidates = [os.path.abspath(uri)]
        else:
            importer_path = None if importer is None else importer.pos.abspath
            bases = list(reversed([*path, os.getcwd() if importer_path is None else os.path.dirname(importer_path)]))
            candidates = [os.path.abspath(os.path.join(base, uri)) for base in bases]
        denied = False
        for candidate in candidates:
            try:
                contained = os.path.commonpath((canonical_root, candidate)) == canonical_root
            except ValueError:
                contained = False
            auxiliary = importer is None and candidate in canonical_auxiliary
            if not contained and not auxiliary:
                denied = True
                continue
            canonical = os.path.realpath(candidate)
            if canonical != candidate:
                denied = True
                continue
            try:
                descriptor = os.open(
                    candidate,
                    os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0),
                )
            except FileNotFoundError:
                continue
            except OSError as exn:
                if exn.errno in (errno.ELOOP, errno.ENOTDIR):
                    denied = True
                    continue
                raise
            try:
                before = os.fstat(descriptor)
                if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_WDL_SOURCE_BYTES:
                    raise PermissionError("isolated fixture runner denied an unsafe WDL import")
                chunks = []
                remaining = before.st_size + 1
                while remaining > 0:
                    chunk = os.read(descriptor, min(65536, remaining))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    remaining -= len(chunk)
                encoded = b"".join(chunks)
                after = os.fstat(descriptor)
                if (
                    len(encoded) != before.st_size
                    or after.st_dev != before.st_dev
                    or after.st_ino != before.st_ino
                    or after.st_size != before.st_size
                    or after.st_mtime_ns != before.st_mtime_ns
                    or after.st_ctime_ns != before.st_ctime_ns
                ):
                    raise PermissionError("isolated fixture runner denied a changing WDL import")
                try:
                    source = encoded.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exn:
                    raise PermissionError("isolated fixture runner denied a non-UTF-8 WDL import") from exn
                return WDL.ReadSourceResult(source_text=source, abspath=candidate)
            finally:
                os.close(descriptor)
        if denied:
            raise PermissionError("isolated fixture runner denied a WDL import outside its snapshot")
        raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), uri)

    return read_source


def bounded_text(value: str, maximum: int = 512) -> str:
    encoded = str(value).encode("utf-8", errors="replace")
    if len(encoded) <= maximum:
        return encoded.decode("utf-8", errors="replace")
    return encoded[:maximum].decode("utf-8", errors="replace") + "…"


def configured_budgets(cfg: config.Loader) -> Dict[str, int]:
    budgets: Dict[str, int] = {}
    for key, minimum in MIN_BUDGETS.items():
        selected = cfg.get_int("dsh_fixture_docker", key)
        if selected < minimum or selected > MAX_BUDGETS[key]:
            raise RunnerError(
                f"isolated fixture budget {key} must be from {minimum} to {MAX_BUDGETS[key]}"
            )
        budgets[key] = selected
    if budgets["artifact_bytes"] > budgets["total_output_bytes"]:
        raise RunnerError("isolated artifact byte budget exceeds total output budget")
    return budgets


class RunnerError(RuntimeError):
    pass


def runner_config_path() -> str:
    try:
        index = sys.argv.index("--cfg")
        path = sys.argv[index + 1]
    except (ValueError, IndexError) as exn:
        raise RunnerError("isolated fixture runner requires one explicit configuration file") from exn
    if not os.path.isabs(path) or not SAFE_HOST_PATH.fullmatch(path):
        raise RunnerError("isolated fixture runner configuration path is unsafe")
    return path


def read_guard_config() -> Dict[str, Any]:
    path = runner_config_path()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 64 * 1024:
            raise RunnerError("isolated fixture runner configuration is invalid")
        chunks = []
        remaining = metadata.st_size + 1
        while remaining > 0:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        encoded = b"".join(chunks)
        completed = os.fstat(descriptor)
        if (
            len(encoded) != metadata.st_size
            or completed.st_dev != metadata.st_dev
            or completed.st_ino != metadata.st_ino
            or completed.st_size != metadata.st_size
            or completed.st_mtime_ns != metadata.st_mtime_ns
            or completed.st_ctime_ns != metadata.st_ctime_ns
        ):
            raise RunnerError("isolated fixture runner configuration changed while reading")
    finally:
        os.close(descriptor)
    parser = configparser.ConfigParser(interpolation=None)
    try:
        parser.read_string(encoded.decode("utf-8", errors="strict"))
        section = parser["dsh_fixture_docker"]
        result: Dict[str, Any] = {
            "testId": section["test_id"],
            "planDigest": section["plan_digest"],
            "testRoot": os.path.realpath(section["test_root"]),
            "wdlRoot": os.path.realpath(section["wdl_root"]),
            "fixtureRoot": os.path.realpath(section["fixture_root"]),
            "fixtureDataRoot": os.path.realpath(section["fixture_data_root"]),
            "inputsPath": os.path.realpath(section["inputs_path"]),
            "evidencePath": os.path.realpath(section["evidence_path"]),
            "launchGatePath": os.path.realpath(section["launch_gate_path"]),
            "launchGateDigest": section["launch_gate_digest"],
            "dockerExecutable": os.path.realpath(section["docker_executable"]),
            "runtimeEnvironmentDigest": section["runtime_environment_digest"],
            "wrapperDigest": section["wrapper_digest"],
            "controllerEnvironmentDigest": section["controller_environment_digest"],
            "controllerNetworkFilterDigest": section["controller_network_filter_digest"],
            "memoryBytes": section.getint("memory_bytes"),
            "pids": section.getint("pids"),
            "wallTimeMs": section.getint("wall_time_ms"),
            "totalOutputBytes": section.getint("total_output_bytes"),
        }
    except (KeyError, ValueError, UnicodeError, configparser.Error) as exn:
        raise RunnerError("isolated fixture runner guard configuration is invalid") from exn
    if not TEST_ID.fullmatch(result["testId"]) or not all(
        DIGEST.fullmatch(result[key])
        for key in (
            "planDigest",
            "runtimeEnvironmentDigest",
            "wrapperDigest",
            "controllerEnvironmentDigest",
            "controllerNetworkFilterDigest",
            "launchGateDigest",
        )
    ):
        raise RunnerError("isolated fixture runner guard identity is invalid")
    for key in (
        "testRoot",
        "wdlRoot",
        "fixtureRoot",
        "fixtureDataRoot",
        "inputsPath",
        "evidencePath",
        "launchGatePath",
        "dockerExecutable",
    ):
        if not SAFE_HOST_PATH.fullmatch(result[key]):
            raise RunnerError("isolated fixture runner guard path is unsafe")
    for child in (
        result["wdlRoot"],
        result["fixtureRoot"],
        result["fixtureDataRoot"],
        result["inputsPath"],
        result["evidencePath"],
        result["launchGatePath"],
    ):
        try:
            contained = os.path.commonpath((result["testRoot"], child)) == result["testRoot"]
        except ValueError:
            contained = False
        if not contained:
            raise RunnerError("isolated fixture runner guard path escaped the test root")
    return result


def await_launch_gate(guard: Dict[str, Any]) -> None:
    deadline = time.monotonic() + min(15.0, guard["wallTimeMs"] / 1000.0)
    while time.monotonic() < deadline:
        try:
            descriptor = os.open(
                guard["launchGatePath"],
                os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0),
            )
        except FileNotFoundError:
            time.sleep(0.01)
            continue
        try:
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or before.st_size != 32:
                raise RunnerError("isolated controller launch gate is invalid")
            token = os.read(descriptor, 33)
            after = os.fstat(descriptor)
            if (
                len(token) != 32
                or after.st_dev != before.st_dev
                or after.st_ino != before.st_ino
                or after.st_size != before.st_size
                or after.st_mtime_ns != before.st_mtime_ns
                or after.st_ctime_ns != before.st_ctime_ns
            ):
                raise RunnerError("isolated controller launch gate changed while reading")
            observed = "sha256:" + hashlib.sha256(token).hexdigest()
            if observed != guard["launchGateDigest"]:
                raise RunnerError("isolated controller launch gate identity is invalid")
            return
        finally:
            os.close(descriptor)
    raise RunnerError("isolated controller launch gate was not durably released")


def current_uid_task_count() -> int:
    uid = os.geteuid()
    count = 0
    for entry in os.scandir("/proc"):
        if not entry.name.isdigit():
            continue
        try:
            if os.stat(entry.path).st_uid == uid:
                with os.scandir(os.path.join(entry.path, "task")) as tasks:
                    count += sum(1 for task in tasks if task.name.isdigit())
        except (FileNotFoundError, PermissionError):
            continue
        if count > 1_000_000:
            raise RunnerError("controller process count identity exceeded its bound")
    return count


def set_bounded_rlimit(kind: int, maximum: int, label: str) -> Dict[str, int]:
    before_soft, before_hard = resource.getrlimit(kind)
    if before_hard != resource.RLIM_INFINITY and before_hard < maximum:
        raise RunnerError(f"controller {label} resource limit is below the approved budget")
    if maximum < 1:
        raise RunnerError(f"controller {label} resource limit is unavailable")
    resource.setrlimit(kind, (maximum, maximum))
    observed = resource.getrlimit(kind)
    if observed != (maximum, maximum):
        raise RunnerError(f"controller {label} resource limit did not apply exactly")
    return {"soft": int(observed[0]), "hard": int(observed[1])}


def send_broker_frame(channel: socket.socket, value: Dict[str, Any]) -> None:
    encoded = stable_json(value).encode("utf-8")
    if len(encoded) > MAX_BROKER_MESSAGE_BYTES:
        raise RunnerError("Docker broker message exceeds its byte limit")
    channel.sendall(len(encoded).to_bytes(4, "big") + encoded)


def receive_broker_bytes(channel: socket.socket, size: int) -> bytes:
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = channel.recv(remaining)
        if not chunk:
            raise RunnerError("Docker broker channel closed unexpectedly")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def receive_broker_frame(channel: socket.socket) -> Dict[str, Any]:
    size = int.from_bytes(receive_broker_bytes(channel, 4), "big")
    if size < 2 or size > MAX_BROKER_MESSAGE_BYTES:
        raise RunnerError("Docker broker message length is invalid")
    try:
        value = json.loads(receive_broker_bytes(channel, size).decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exn:
        raise RunnerError("Docker broker returned invalid JSON") from exn
    if not isinstance(value, dict):
        raise RunnerError("Docker broker returned an invalid message")
    return value


def run_bounded_broker_process(
    argv: List[str], timeout_seconds: float
) -> Tuple[int, bytes, bytes, bool, bool]:
    process = subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        close_fds=True,
    )
    if process.stdout is None or process.stderr is None:
        process.kill()
        process.wait()
        raise RunnerError("Docker broker pipes were unavailable")
    streams = {process.stdout.fileno(): "stdout", process.stderr.fileno(): "stderr"}
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    overflow = {"stdout": False, "stderr": False}
    selector = selectors.DefaultSelector()
    for descriptor in streams:
        os.set_blocking(descriptor, False)
        selector.register(descriptor, selectors.EVENT_READ)
    deadline = time.monotonic() + timeout_seconds
    try:
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout_seconds)
            for selected, _events in selector.select(min(0.1, remaining)):
                descriptor = selected.fd
                try:
                    chunk = os.read(descriptor, 64 * 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(descriptor)
                    continue
                label = streams[descriptor]
                capacity = MAX_DOCKER_OUTPUT_BYTES + 1 - len(buffers[label])
                if capacity > 0:
                    buffers[label].extend(chunk[:capacity])
                if len(chunk) > capacity:
                    overflow[label] = True
        returncode = process.wait(timeout=max(0.001, deadline - time.monotonic()))
        return (
            returncode,
            bytes(buffers["stdout"]),
            bytes(buffers["stderr"]),
            overflow["stdout"] or len(buffers["stdout"]) > MAX_DOCKER_OUTPUT_BYTES,
            overflow["stderr"] or len(buffers["stderr"]) > MAX_DOCKER_OUTPUT_BYTES,
        )
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        raise
    finally:
        selector.close()
        process.stdout.close()
        process.stderr.close()


def docker_broker_child(channel: socket.socket, guard: Dict[str, Any]) -> None:
    try:
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        network_filter = controller_network_filter_identity()
        install_controller_network_seccomp(network_filter)
        process_count = current_uid_task_count()
        limits = {
            "addressSpace": set_bounded_rlimit(
                resource.RLIMIT_AS,
                DOCKER_BROKER_VIRTUAL_ADDRESS_SPACE_BYTES,
                "Docker-broker-address-space",
            ),
            "cpuSeconds": set_bounded_rlimit(
                resource.RLIMIT_CPU,
                max(1, math.ceil(guard["wallTimeMs"] / 1000)),
                "Docker-broker-CPU-time",
            ),
            "processes": set_bounded_rlimit(
                resource.RLIMIT_NPROC,
                process_count + DOCKER_BROKER_ADDITIONAL_PROCESSES,
                "Docker-broker-process-count",
            ),
            "openFiles": set_bounded_rlimit(
                resource.RLIMIT_NOFILE, 256, "Docker-broker-open-files"
            ),
            "fileBytes": set_bounded_rlimit(
                resource.RLIMIT_FSIZE,
                guard["totalOutputBytes"],
                "Docker-broker-file-size",
            ),
        }
        send_broker_frame(
            channel,
            {
                "ok": True,
                "identity": {
                    "networkFilterDigest": network_filter["filterDigest"],
                    "kernelEnforced": True,
                    "threadSynchronized": True,
                    "limits": limits,
                    "processBaseline": process_count,
                },
            },
        )
        while True:
            request = receive_broker_frame(channel)
            if request == {"operation": "shutdown"}:
                send_broker_frame(channel, {"ok": True})
                return
            if set(request) != {"operation", "argv", "timeoutMs"} or request.get(
                "operation"
            ) != "run":
                raise RunnerError("Docker broker request shape is invalid")
            argv = request.get("argv")
            timeout_ms = request.get("timeoutMs")
            if (
                not isinstance(argv, list)
                or not 2 <= len(argv) <= 256
                or argv[0] != guard["dockerExecutable"]
                or any(
                    not isinstance(item, str)
                    or not item
                    or len(item.encode("utf-8")) > 16 * 1024
                    or "\x00" in item
                    for item in argv
                )
                or not isinstance(timeout_ms, int)
                or not 1 <= timeout_ms <= 30_000
            ):
                raise RunnerError("Docker broker rejected an invalid bounded command")
            try:
                returncode, stdout, stderr, stdout_overflow, stderr_overflow = (
                    run_bounded_broker_process(argv, timeout_ms / 1000.0)
                )
                send_broker_frame(
                    channel,
                    {
                        "ok": True,
                        "returncode": returncode,
                        "stdout": stdout.decode("utf-8", errors="replace"),
                        "stderr": stderr.decode("utf-8", errors="replace"),
                        "stdoutOverflow": stdout_overflow,
                        "stderrOverflow": stderr_overflow,
                    },
                )
            except subprocess.TimeoutExpired:
                send_broker_frame(channel, {"ok": False, "code": "timeout"})
    except BaseException as exn:
        try:
            send_broker_frame(
                channel,
                {"ok": False, "code": "broker_failed", "message": bounded_text(str(exn))},
            )
        except BaseException:
            pass
        raise
    finally:
        channel.close()


def start_docker_broker(guard: Dict[str, Any]) -> Dict[str, Any]:
    global _DOCKER_BROKER_SOCKET, _DOCKER_BROKER_PID
    if _DOCKER_BROKER_SOCKET is not None or _DOCKER_BROKER_PID is not None:
        raise RunnerError("Docker broker was already started")
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    pid = os.fork()
    if pid == 0:
        parent.close()
        try:
            docker_broker_child(child, guard)
        finally:
            os._exit(0)
    child.close()
    _DOCKER_BROKER_SOCKET = parent
    _DOCKER_BROKER_PID = pid
    response = receive_broker_frame(parent)
    if response.get("ok") is not True or not isinstance(response.get("identity"), dict):
        stop_docker_broker()
        raise RunnerError("Docker broker failed its bounded startup guard")
    return response["identity"]


def stop_docker_broker() -> None:
    global _DOCKER_BROKER_SOCKET, _DOCKER_BROKER_PID
    channel = _DOCKER_BROKER_SOCKET
    pid = _DOCKER_BROKER_PID
    _DOCKER_BROKER_SOCKET = None
    _DOCKER_BROKER_PID = None
    if channel is not None:
        try:
            send_broker_frame(channel, {"operation": "shutdown"})
            receive_broker_frame(channel)
        except BaseException:
            pass
        channel.close()
    if pid is None:
        return
    deadline = time.monotonic() + 1.0
    while time.monotonic() < deadline:
        waited, _ = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            return
        time.sleep(0.01)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)


def run_docker_broker(argv: List[str], timeout: float) -> Dict[str, Any]:
    if _DOCKER_BROKER_SOCKET is None:
        raise RunnerError("Docker broker is unavailable")
    timeout_ms = max(1, min(30_000, math.ceil(timeout * 1000)))
    with _DOCKER_BROKER_LOCK:
        send_broker_frame(
            _DOCKER_BROKER_SOCKET,
            {"operation": "run", "argv": argv, "timeoutMs": timeout_ms},
        )
        return receive_broker_frame(_DOCKER_BROKER_SOCKET)


def start_resident_memory_watchdog(maximum_bytes: int) -> Dict[str, Any]:
    global _MEMORY_WATCHDOG
    if _MEMORY_WATCHDOG is not None:
        raise RunnerError("controller resident-memory watchdog was already started")

    def monitor() -> None:
        while True:
            try:
                with open("/proc/self/status", "r", encoding="utf-8") as handle:
                    status = handle.read(64 * 1024)
                match = re.search(r"^VmRSS:\s+([0-9]+)\s+kB$", status, re.MULTILINE)
                if match is None:
                    os.kill(os.getpid(), signal.SIGKILL)
                if int(match.group(1)) * 1024 > maximum_bytes:
                    os.kill(os.getpid(), signal.SIGKILL)
            except Exception:
                os.kill(os.getpid(), signal.SIGKILL)
            time.sleep(0.005)

    _MEMORY_WATCHDOG = threading.Thread(
        target=monitor,
        name="dsh-controller-memory-watchdog",
        daemon=True,
    )
    _MEMORY_WATCHDOG.start()
    if not _MEMORY_WATCHDOG.is_alive():
        raise RunnerError("controller resident-memory watchdog failed to start")
    return {
        "maximumBytes": maximum_bytes,
        "enforcement": "rlimit_as_hard_with_proc_rss_watchdog",
        "intervalMs": 5,
    }


def apply_controller_guards(
    guard: Dict[str, Any],
    runtime: Dict[str, Any],
    wrapper_digest: str,
    docker_broker: Dict[str, Any],
) -> Dict[str, Any]:
    network_filter = controller_network_filter_identity()
    if network_filter["filterDigest"] != guard["controllerNetworkFilterDigest"]:
        raise RunnerError("controller network filter identity changed after plan approval")
    if runtime["environmentDigest"] != guard["runtimeEnvironmentDigest"]:
        raise RunnerError("Python runtime dependency identity changed after plan approval")
    if wrapper_digest != guard["wrapperDigest"]:
        raise RunnerError("isolated runner wrapper identity changed after plan approval")

    redacted_environment = dict(os.environ)
    expected_home = os.path.join(guard["testRoot"], "controller-home")
    if redacted_environment.get("HOME") == expected_home:
        redacted_environment["HOME"] = "$RUN/controller-home"
    environment_basis = dict(sorted(redacted_environment.items()))
    environment_digest = digest(environment_basis, "controller-environment")
    if (
        environment_basis != FIXED_CONTROLLER_ENVIRONMENT
        or environment_digest != guard["controllerEnvironmentDigest"]
    ):
        raise RunnerError("isolated controller environment was not the exact approved allowlist")

    canary = start_controller_host_canary()
    canary_connections = canary.connections
    install_controller_network_seccomp(network_filter)
    install_controller_network_guard()
    try:
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    except PermissionError as exn:
        if exn.errno != errno.EPERM:
            raise
    else:
        raise RunnerError("controller kernel network-denial probe unexpectedly created an IP socket")
    try:
        socket.getaddrinfo("example.invalid", 443)
    except PermissionError as exn:
        if exn.errno != errno.EPERM:
            raise
    else:
        raise RunnerError("controller name-resolution denial probe unexpectedly succeeded")
    process_count = current_uid_task_count()
    limits = {
        "addressSpace": set_bounded_rlimit(
            resource.RLIMIT_AS,
            guard["memoryBytes"],
            "address-space",
        ),
        "cpuSeconds": set_bounded_rlimit(
            resource.RLIMIT_CPU,
            max(1, math.ceil(guard["wallTimeMs"] / 1000)),
            "CPU-time",
        ),
        "processes": set_bounded_rlimit(
            resource.RLIMIT_NPROC, process_count + guard["pids"], "process-count"
        ),
        "openFiles": set_bounded_rlimit(resource.RLIMIT_NOFILE, 256, "open-files"),
        "fileBytes": set_bounded_rlimit(
            resource.RLIMIT_FSIZE, guard["totalOutputBytes"], "file-size"
        ),
    }
    limits["residentMemory"] = start_resident_memory_watchdog(guard["memoryBytes"])

    def wall_timeout(_signum: int, _frame: Any) -> None:
        raise RunnerError("isolated controller wall-time budget exceeded")

    signal.signal(signal.SIGALRM, wall_timeout)
    signal.setitimer(signal.ITIMER_REAL, guard["wallTimeMs"] / 1000.0)

    if canary_connections != 1:
        raise RunnerError("isolated controller host-canary positive control was invalid")

    controller_basis = {
        "testId": guard["testId"],
        "planDigest": guard["planDigest"],
        "network": {
            "policy": network_filter["policy"],
            "architecture": network_filter["architecture"],
            "filterDigest": network_filter["filterDigest"],
            "kernelEnforced": True,
            "threadSynchronized": True,
            "outboundDenied": True,
            "nameResolutionDenied": True,
            "hostCanaryConnections": canary_connections,
        },
        "environment": {
            "keys": sorted(environment_basis),
            "nonEmptyKeys": sorted(key for key, value in environment_basis.items() if value),
            "credentialLikeKeys": [],
            "environmentDigest": environment_digest,
        },
        "limits": limits,
        "processBaseline": process_count,
        "runtimeEnvironmentDigest": runtime["environmentDigest"],
        "wrapperDigest": wrapper_digest,
        "dockerBroker": docker_broker,
    }
    append_evidence(
        guard["evidencePath"],
        {
            "type": "controller_guard",
            **controller_basis,
            "controllerGuardDigest": digest(controller_basis, "controller-guard"),
        },
    )
    return controller_basis


def run_bounded(
    argv: List[str],
    *,
    timeout: float = 30.0,
    check: bool = True,
    accepted: Tuple[int, ...] = (0,),
) -> subprocess.CompletedProcess[str]:
    response = run_docker_broker(argv, timeout)
    if response.get("ok") is not True:
        if response.get("code") == "timeout":
            raise RunnerError(f"bounded command timed out: {argv[0]}")
        raise RunnerError("Docker broker failed closed")
    if (
        set(response) != {
            "ok",
            "returncode",
            "stdout",
            "stderr",
            "stdoutOverflow",
            "stderrOverflow",
        }
        or not isinstance(response.get("returncode"), int)
        or not isinstance(response.get("stdout"), str)
        or not isinstance(response.get("stderr"), str)
    ):
        raise RunnerError("Docker broker response shape is invalid")
    result = subprocess.CompletedProcess(
        argv,
        response["returncode"],
        response["stdout"],
        response["stderr"],
    )
    if response["stdoutOverflow"] or len(result.stdout.encode("utf-8")) > MAX_DOCKER_OUTPUT_BYTES:
        raise RunnerError(f"bounded command stdout exceeded {MAX_DOCKER_OUTPUT_BYTES} bytes")
    if response["stderrOverflow"] or len(result.stderr.encode("utf-8")) > MAX_DOCKER_OUTPUT_BYTES:
        raise RunnerError(f"bounded command stderr exceeded {MAX_DOCKER_OUTPUT_BYTES} bytes")
    if check and result.returncode not in accepted:
        detail = bounded_text(result.stderr.strip() or result.stdout.strip() or "command failed")
        raise RunnerError(f"bounded command failed ({result.returncode}): {detail}")
    return result


def image_identity(docker: str, image: str) -> Dict[str, Any]:
    if not PINNED_IMAGE.fullmatch(image):
        raise RunnerError("container image must be an exact SHA-256 digest-pinned reference")
    result = run_bounded(
        [
            docker,
            "image",
            "inspect",
            "--format",
            "{{.Id}}\t{{json .RepoDigests}}\t{{json .Config.Env}}",
            image,
        ]
    )
    fields = result.stdout.strip().split("\t", 2)
    if len(fields) != 3 or not re.fullmatch(r"sha256:[a-f0-9]{64}", fields[0]):
        raise RunnerError("local container image identity probe returned an invalid image id")
    try:
        repo_digests = json.loads(fields[1])
        environment = json.loads(fields[2])
    except json.JSONDecodeError as exn:
        raise RunnerError("local container image metadata are invalid") from exn
    if image not in repo_digests:
        raise RunnerError("exact digest-pinned image is not present in the local image store")
    environment_keys: List[str] = []
    if not isinstance(environment, list) or len(environment) > 128:
        raise RunnerError("local container image environment metadata are invalid")
    for item in environment:
        if not isinstance(item, str) or "=" not in item:
            raise RunnerError("local container image environment metadata are invalid")
        key = item.split("=", 1)[0]
        if not ENVIRONMENT_NAME.fullmatch(key) or key in environment_keys:
            raise RunnerError("local container image environment metadata are invalid")
        environment_keys.append(key)
    return {
        "reference": image,
        "imageId": fields[0],
        "environmentKeys": sorted(environment_keys),
    }


INSPECT_FORMAT = (
    '{'
    '"id":{{json .Id}},'
    '"imageId":{{json .Image}},'
    '"configImage":{{json .Config.Image}},'
    '"user":{{json .Config.User}},'
    '"networkMode":{{json .HostConfig.NetworkMode}},'
    '"readonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},'
    '"privileged":{{json .HostConfig.Privileged}},'
    '"capDrop":{{json .HostConfig.CapDrop}},'
    '"securityOpt":{{json .HostConfig.SecurityOpt}},'
    '"pidsLimit":{{json .HostConfig.PidsLimit}},'
    '"nanoCpus":{{json .HostConfig.NanoCpus}},'
    '"memory":{{json .HostConfig.Memory}},'
    '"memorySwap":{{json .HostConfig.MemorySwap}},'
    '"ipcMode":{{json .HostConfig.IpcMode}},'
    '"pidMode":{{json .HostConfig.PidMode}},'
    '"cgroupnsMode":{{json .HostConfig.CgroupnsMode}},'
    '"devices":{{json .HostConfig.Devices}},'
    '"deviceRequests":{{json .HostConfig.DeviceRequests}},'
    '"groupAdd":{{json .HostConfig.GroupAdd}},'
    '"logDriver":{{json .HostConfig.LogConfig.Type}},'
    '"tmpfs":{{json .HostConfig.Tmpfs}},'
    '"ulimits":{{json .HostConfig.Ulimits}},'
    '"apparmorProfile":{{json .AppArmorProfile}},'
    '"environment":{{json .Config.Env}},'
    '"mounts":{{json .Mounts}}'
    '}'
)


def inspect_container(docker: str, container: str) -> Dict[str, Any]:
    # Docker's Go template is used to select a bounded set of fields. The outer JSON object above
    # stores template expansions as strings so image-controlled labels/env never enter the result.
    result = run_bounded([docker, "container", "inspect", "--format", INSPECT_FORMAT, container])
    try:
        facts = dict(json.loads(result.stdout))
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exn:
        raise RunnerError("Docker container inspection returned invalid bounded facts") from exn
    facts["token"] = owned_container_token(docker, container)
    return facts


def validate_container_facts(
    facts: Dict[str, Any],
    *,
    token: str,
    image: Dict[str, str],
    uid_gid: str,
    cpu: int,
    memory: int,
    pids: int,
    tmp_bytes: int,
    file_bytes: int,
    expected_mounts: List[Dict[str, Any]],
) -> Dict[str, Any]:
    required_security = {"no-new-privileges=true", "seccomp=builtin", "apparmor=docker-default"}
    mounts = sorted(
        [
            {
                "type": mount.get("Type"),
                "source": mount.get("Source"),
                "destination": mount.get("Destination"),
                "name": mount.get("Name", ""),
                "rw": mount.get("RW"),
                "propagation": mount.get("Propagation", ""),
            }
            for mount in facts["mounts"]
        ],
        key=lambda mount: stable_json(mount),
    )
    expected_mounts = sorted(expected_mounts, key=lambda mount: stable_json(mount))
    environment = facts.get("environment") or []
    environment_map: Dict[str, str] = {}
    environment_valid = True
    for item in environment:
        if not isinstance(item, str) or "=" not in item:
            environment_valid = False
            continue
        key, value = item.split("=", 1)
        if key in environment_map:
            environment_valid = False
        environment_map[key] = value
    ulimits = sorted(
        [
            {
                "name": item.get("Name"),
                "soft": item.get("Soft"),
                "hard": item.get("Hard"),
            }
            for item in (facts.get("ulimits") or [])
        ],
        key=lambda item: str(item["name"]),
    )
    expected_ulimits = [
        {"name": "fsize", "soft": file_bytes, "hard": file_bytes},
        {"name": "nofile", "soft": 256, "hard": 256},
    ]
    tmpfs_options = f"rw,nosuid,nodev,noexec,size={tmp_bytes},uid={uid_gid.split(':')[0]},gid={uid_gid.split(':')[1]},mode=0700"
    checks = {
        "token": facts["token"] == token,
        "image": facts["configImage"] == image["reference"] and facts["imageId"] == image["imageId"],
        "user": facts["user"] == uid_gid,
        "network_none": facts["networkMode"] == "none",
        "read_only_root": facts["readonlyRootfs"] is True,
        "not_privileged": facts["privileged"] is False,
        "capabilities_dropped": set(facts["capDrop"] or []) == {"ALL"},
        "security_options": required_security.issubset(set(facts["securityOpt"] or [])),
        "pids": facts["pidsLimit"] == pids,
        "cpu": facts["nanoCpus"] == cpu * 1_000_000_000,
        "memory": facts["memory"] == memory and facts["memorySwap"] == memory,
        "ipc": facts["ipcMode"] == "none",
        "pid_namespace": facts["pidMode"] in ("", None),
        "cgroup_namespace": facts["cgroupnsMode"] == "private",
        "devices": not facts["devices"] and not facts["deviceRequests"],
        "supplementary_groups": not facts["groupAdd"],
        "log_driver": facts["logDriver"] == "none",
        "tmpfs": facts.get("tmpfs") == {"/tmp": tmpfs_options},
        "ulimits": ulimits == expected_ulimits,
        "apparmor": facts["apparmorProfile"] == "docker-default",
        "mounts": mounts == expected_mounts,
        "docker_socket_absent": all(
            mount.get("Destination") not in ("/var/run/docker.sock", "/run/docker.sock")
            for mount in facts["mounts"]
        ),
        "mounts_non_propagating": all(
            mount.get("Propagation", "rprivate") in ("", "rprivate") for mount in facts["mounts"]
        ),
        "environment": environment_valid and environment_map == {
            **{key: "" for key in image["environmentKeys"]},
            **FIXED_CONTAINER_ENVIRONMENT,
        },
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        raise RunnerError("Docker container isolation inspection failed: " + ", ".join(failed))
    public_facts = {
        "imageId": facts["imageId"],
        "user": facts["user"],
        "networkMode": facts["networkMode"],
        "readonlyRootfs": facts["readonlyRootfs"],
        "capDrop": facts["capDrop"],
        "securityOpt": sorted(facts["securityOpt"]),
        "pidsLimit": facts["pidsLimit"],
        "nanoCpus": facts["nanoCpus"],
        "memory": facts["memory"],
        "memorySwap": facts["memorySwap"],
        "ipcMode": facts["ipcMode"],
        "pidMode": facts["pidMode"],
        "cgroupnsMode": facts["cgroupnsMode"],
        "devices": facts["devices"] or [],
        "deviceRequests": facts["deviceRequests"] or [],
        "groupAdd": facts["groupAdd"] or [],
        "logDriver": facts["logDriver"],
        "tmpfs": facts.get("tmpfs") or {},
        "ulimits": ulimits,
        "apparmorProfile": facts["apparmorProfile"],
        "environment": dict(sorted(environment_map.items())),
        "mounts": mounts,
    }
    return {"checks": checks, "facts": public_facts, "configDigest": digest(public_facts, "container-config")}


def public_container_controls(
    facts: Dict[str, Any],
    *,
    output_storage_digest: Optional[str] = None,
) -> Dict[str, Any]:
    public_facts = facts["facts"]
    controls = {
        "networkMode": public_facts["networkMode"],
        "readonlyRootfs": public_facts["readonlyRootfs"],
        "capDrop": public_facts["capDrop"],
        "securityOpt": public_facts["securityOpt"],
        "pidsLimit": public_facts["pidsLimit"],
        "nanoCpus": public_facts["nanoCpus"],
        "memory": public_facts["memory"],
        "memorySwap": public_facts["memorySwap"],
        "ipcMode": public_facts["ipcMode"],
        "pidMode": public_facts["pidMode"],
        "cgroupnsMode": public_facts["cgroupnsMode"],
        "devices": len(public_facts["devices"]),
        "deviceRequests": len(public_facts["deviceRequests"]),
        "supplementaryGroups": len(public_facts["groupAdd"]),
        "logDriver": public_facts["logDriver"],
        "apparmorProfile": public_facts["apparmorProfile"],
        "environment": public_facts["environment"],
        "tmpfs": public_facts["tmpfs"],
        "ulimits": public_facts["ulimits"],
        "mounts": [
            {
                "type": mount["type"],
                "destination": mount["destination"],
                "rw": mount["rw"],
                "propagation": mount["propagation"],
            }
            for mount in public_facts["mounts"]
        ],
    }
    if output_storage_digest is not None:
        controls["outputStorageDigest"] = output_storage_digest
    return controls


def expected_resource_labels(token: str, test_id: str, plan_digest: str) -> Dict[str, str]:
    return {
        OWNER_LABEL: OWNER_LABEL_VALUE,
        TEST_ID_LABEL: test_id,
        PLAN_DIGEST_LABEL: plan_digest,
        TOKEN_LABEL: token,
    }


def labels_match(observed: Optional[Dict[str, str]], expected: Dict[str, str]) -> bool:
    return observed is not None and all(observed.get(key) == value for key, value in expected.items())


def container_labels(docker: str, name: str) -> Optional[Dict[str, str]]:
    result = run_bounded(
        [docker, "container", "inspect", "--format", "{{json .Config.Labels}}", name],
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        labels = json.loads(result.stdout)
    except json.JSONDecodeError as exn:
        raise RunnerError("Docker container ownership labels are invalid") from exn
    if not isinstance(labels, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in labels.items()
    ):
        raise RunnerError("Docker container ownership labels are invalid")
    return labels


def owned_container_token(docker: str, name: str) -> Optional[str]:
    labels = container_labels(docker, name)
    return None if labels is None else labels.get(TOKEN_LABEL)


def remove_owned_container(
    docker: str, name: str, token: str, test_id: str, plan_digest: str
) -> None:
    expected = expected_resource_labels(token, test_id, plan_digest)
    labels = container_labels(docker, name)
    if labels is None:
        return
    if any(labels.get(key) != value for key, value in expected.items()):
        raise RunnerError("refusing to remove a Docker container with mismatched ownership")
    for _attempt in range(3):
        result = run_bounded([docker, "container", "rm", "--force", name], check=False)
        if result.returncode == 0 and container_labels(docker, name) is None:
            return
        time.sleep(0.05)
    raise RunnerError("owned Docker container cleanup could not be verified")


def volume_labels(docker: str, name: str) -> Optional[Dict[str, str]]:
    result = run_bounded(
        [docker, "volume", "inspect", "--format", "{{json .Labels}}", name],
        check=False,
    )
    if result.returncode != 0:
        return None
    try:
        labels = json.loads(result.stdout)
    except json.JSONDecodeError as exn:
        raise RunnerError("Docker volume ownership labels are invalid") from exn
    if not isinstance(labels, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in labels.items()
    ):
        raise RunnerError("Docker volume ownership labels are invalid")
    return labels


def owned_volume_token(docker: str, name: str) -> Optional[str]:
    labels = volume_labels(docker, name)
    return None if labels is None else labels.get(TOKEN_LABEL)


def remove_owned_volume(
    docker: str, name: str, token: str, test_id: str, plan_digest: str
) -> None:
    expected = expected_resource_labels(token, test_id, plan_digest)
    labels = volume_labels(docker, name)
    if labels is None:
        return
    if any(labels.get(key) != value for key, value in expected.items()):
        raise RunnerError("refusing to remove a Docker volume with mismatched ownership")
    for _attempt in range(3):
        result = run_bounded([docker, "volume", "rm", name], check=False)
        if result.returncode == 0 and volume_labels(docker, name) is None:
            return
        time.sleep(0.05)
    raise RunnerError("owned Docker volume cleanup could not be verified")


def create_owned_container(
    docker: str,
    argv: List[str],
    name: str,
    token: str,
    test_id: str,
    plan_digest: str,
) -> str:
    result = run_bounded(argv, check=False)
    if result.returncode != 0:
        if labels_match(
            container_labels(docker, name), expected_resource_labels(token, test_id, plan_digest)
        ):
            raise RunnerError("Docker container create outcome was ambiguous; owned container will be removed without start")
        raise RunnerError(f"Docker container create failed: {bounded_text(result.stderr.strip())}")
    container_id = result.stdout.strip()
    if (
        not re.fullmatch(r"[a-f0-9]{64}", container_id)
        or not labels_match(
            container_labels(docker, name), expected_resource_labels(token, test_id, plan_digest)
        )
    ):
        raise RunnerError("Docker container create returned an invalid or unowned identity")
    return container_id


def create_tmpfs_volume(
    docker: str,
    name: str,
    token: str,
    size: int,
    uid: int,
    gid: int,
    test_id: str,
    plan_digest: str,
) -> None:
    result = run_bounded(
        [
            docker,
            "volume",
            "create",
            "--driver",
            "local",
            "--label",
            f"{TOKEN_LABEL}={token}",
            "--label",
            f"{OWNER_LABEL}={OWNER_LABEL_VALUE}",
            "--label",
            f"{TEST_ID_LABEL}={test_id}",
            "--label",
            f"{PLAN_DIGEST_LABEL}={plan_digest}",
            "--opt",
            "type=tmpfs",
            "--opt",
            "device=tmpfs",
            "--opt",
            f"o=size={size},uid={uid},gid={gid},mode=0700",
            name,
        ],
        check=False,
    )
    if result.returncode != 0:
        if labels_match(volume_labels(docker, name), expected_resource_labels(token, test_id, plan_digest)):
            raise RunnerError("Docker volume create outcome was ambiguous; owned volume will be removed")
        raise RunnerError(f"Docker tmpfs volume create failed: {bounded_text(result.stderr.strip())}")
    if (
        result.stdout.strip() != name
        or not labels_match(
            volume_labels(docker, name), expected_resource_labels(token, test_id, plan_digest)
        )
    ):
        raise RunnerError("Docker tmpfs volume create returned an invalid or unowned identity")


def tmpfs_volume_identity(
    docker: str,
    name: str,
    token: str,
    size: int,
    uid: int,
    gid: int,
) -> Dict[str, Any]:
    if owned_volume_token(docker, name) != token:
        raise RunnerError("Docker tmpfs volume ownership changed before identity inspection")
    result = run_bounded(
        [
            docker,
            "volume",
            "inspect",
            "--format",
            '{"driver":{{json .Driver}},"scope":{{json .Scope}},"options":{{json .Options}}}',
            name,
        ]
    )
    try:
        observed = json.loads(result.stdout)
    except json.JSONDecodeError as exn:
        raise RunnerError("Docker tmpfs volume identity is invalid") from exn
    expected_options = {
        "device": "tmpfs",
        "o": f"size={size},uid={uid},gid={gid},mode=0700",
        "type": "tmpfs",
    }
    if (
        observed.get("driver") != "local"
        or observed.get("scope") != "local"
        or observed.get("options") != expected_options
    ):
        raise RunnerError("Docker output volume is not the exact bounded tmpfs configuration")
    public = {
        "driver": "local",
        "scope": "local",
        "type": "tmpfs",
        "device": "tmpfs",
        "sizeBytes": size,
        "uid": uid,
        "gid": gid,
        "mode": "0700",
    }
    return {"facts": public, "storageDigest": digest(public, "output-storage")}


def volume_mountpoint(docker: str, name: str, token: str) -> str:
    if owned_volume_token(docker, name) != token:
        raise RunnerError("Docker tmpfs volume ownership changed before inspection")
    result = run_bounded(
        [docker, "volume", "inspect", "--format", "{{.Mountpoint}}", name]
    )
    mountpoint = result.stdout.strip()
    if not os.path.isabs(mountpoint) or not SAFE_HOST_PATH.fullmatch(mountpoint):
        raise RunnerError("Docker tmpfs volume returned an unsafe mountpoint")
    return mountpoint


def validate_bind_source(path: str, root: str) -> str:
    if not os.path.isabs(path) or not SAFE_HOST_PATH.fullmatch(path):
        raise RunnerError("Docker bind source is not an approved absolute path")
    canonical_root = os.path.realpath(root)
    canonical = os.path.realpath(path)
    try:
        contained = os.path.commonpath((canonical_root, canonical)) == canonical_root
    except ValueError:
        contained = False
    if not contained or canonical != path:
        raise RunnerError("Docker bind source escapes or aliases the isolated file-I/O root")
    metadata = os.lstat(path)
    if stat.S_ISLNK(metadata.st_mode) or not (
        stat.S_ISREG(metadata.st_mode) or stat.S_ISDIR(metadata.st_mode)
    ):
        raise RunnerError("Docker bind source must be a non-symlink regular file or directory")
    return canonical


def validate_container_destination(path: str) -> str:
    if (
        not SAFE_CONTAINER_PATH.fullmatch(path)
        or os.path.normpath(path) != path
        or not path.startswith(CONTAINER_ROOT + "/")
    ):
        raise RunnerError("Docker bind destination escapes the isolated task root")
    return path


def expected_bind_mount(source: str, destination: str) -> Dict[str, Any]:
    return {
        "type": "bind",
        "source": source,
        "destination": destination,
        "name": "",
        "rw": False,
        "propagation": "rprivate",
    }


def expected_volume_mount(name: str, source: str, destination: str) -> Dict[str, Any]:
    return {
        "type": "volume",
        "source": source,
        "destination": destination,
        "name": name,
        "rw": True,
        "propagation": "",
    }


def common_container_args(
    docker: str,
    *,
    name: str,
    token: str,
    test_id: str,
    plan_digest: str,
    uid: int,
    gid: int,
    cpu: int,
    memory: int,
    pids: int,
    tmp_bytes: int,
    file_bytes: int,
    image_environment_keys: List[str],
) -> List[str]:
    argv = [
        docker,
        "container",
        "create",
        "--name",
        name,
        "--label",
        f"{TOKEN_LABEL}={token}",
        "--label",
        f"{OWNER_LABEL}={OWNER_LABEL_VALUE}",
        "--label",
        f"{TEST_ID_LABEL}={test_id}",
        "--label",
        f"{PLAN_DIGEST_LABEL}={plan_digest}",
        "--pull",
        "never",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges=true",
        "--security-opt",
        "seccomp=builtin",
        "--security-opt",
        "apparmor=docker-default",
        "--pids-limit",
        str(pids),
        "--cpus",
        str(cpu),
        "--memory",
        str(memory),
        "--memory-swap",
        str(memory),
        "--user",
        f"{uid}:{gid}",
        "--ipc",
        "none",
        "--cgroupns",
        "private",
        "--hostname",
        "dsh-fixture",
        "--log-driver",
        "none",
        "--ulimit",
        "nofile=256:256",
        "--ulimit",
        f"fsize={file_bytes}:{file_bytes}",
        "--tmpfs",
        f"/tmp:rw,nosuid,nodev,noexec,size={tmp_bytes},uid={uid},gid={gid},mode=0700",
    ]
    for key in image_environment_keys:
        argv += ["--env", f"{key}="]
    for key, value in FIXED_CONTAINER_ENVIRONMENT.items():
        argv += ["--env", f"{key}={value}"]
    return argv


class HostCanary(contextlib.AbstractContextManager["HostCanary"]):
    def __init__(self) -> None:
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        self.server.settimeout(0.2)
        self.port = self.server.getsockname()[1]
        self.connections = 0
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def _serve(self) -> None:
        while not self.stop.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with connection:
                self.connections += 1
                connection.sendall(b"host-canary")

    def __enter__(self) -> "HostCanary":
        self.thread.start()
        client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        client.settimeout(1.0)
        _ORIGINAL_SOCKET_CONNECT(client, ("127.0.0.1", self.port))
        with client:
            if client.recv(32) != b"host-canary":
                raise RunnerError("host canary positive control returned an invalid response")
        deadline = time.monotonic() + 1.0
        while self.connections != 1 and time.monotonic() < deadline:
            time.sleep(0.01)
        if self.connections != 1:
            raise RunnerError("host canary positive control was not observed")
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop.set()
        self.server.close()
        self.thread.join(timeout=1.0)


def start_controller_host_canary() -> HostCanary:
    global _HOST_CANARY
    if _HOST_CANARY is not None:
        raise RunnerError("controller host canary was already started")
    canary = HostCanary()
    try:
        canary.__enter__()
    except Exception:
        canary.__exit__()
        raise
    _HOST_CANARY = canary
    return canary


def stop_controller_host_canary() -> None:
    global _HOST_CANARY
    canary = _HOST_CANARY
    _HOST_CANARY = None
    if canary is not None:
        canary.__exit__()


def controller_host_canary() -> HostCanary:
    if _HOST_CANARY is None:
        raise RunnerError("controller host canary is unavailable")
    return _HOST_CANARY


PROBE_SCRIPT = r"""
import errno, hashlib, json, os, socket

port = int(__import__('sys').argv[1])
expected = __import__('sys').argv[2]
result = {}

server = socket.socket()
server.bind(('127.0.0.1', 0))
server.listen(1)
client = socket.socket()
client.settimeout(1)
client.connect(server.getsockname())
accepted, _ = server.accept()
accepted.close(); client.close(); server.close()
result['loopback_positive'] = True

result['interfaces'] = [name for _, name in socket.if_nameindex()]
for name, address in (
    ('host_loopback', ('127.0.0.1', port)),
    ('egress', ('192.0.2.1', 9)),
    ('bridge_gateway', ('172.17.0.1', 1)),
):
    probe = socket.socket()
    probe.settimeout(0.3)
    try:
        probe.connect(address)
        result[name] = 'reachable'
    except OSError as exn:
        result[name] = exn.errno
    finally:
        probe.close()

try:
    open('/dsh-root-write', 'wb').write(b'x')
    result['root_write'] = 'writable'
except OSError as exn:
    result['root_write'] = exn.errno

with open('/tmp/dsh-probe', 'wb') as handle:
    handle.write(b'bounded')
result['tmpfs_write'] = True
with open('/fixture/canary', 'rb') as handle:
    result['fixture_sha256'] = 'sha256:' + hashlib.sha256(handle.read()).hexdigest()

status = dict(line.split(':', 1) for line in open('/proc/self/status') if ':' in line)
result['cap_eff'] = status['CapEff'].strip()
result['no_new_privs'] = status['NoNewPrivs'].strip()
result['docker_socket_absent'] = not any(os.path.exists(path) for path in ('/var/run/docker.sock', '/run/docker.sock'))
result['credential_paths_absent'] = not any(os.path.exists(path) for path in ('/run/secrets', '/root/.aws', '/root/.config/gcloud', '/root/.docker'))
credential_markers = ('TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL', 'AWS_', 'GOOGLE_', 'AZURE_')
result['ambient_credentials_absent'] = not any(value and any(marker in key.upper() for marker in credential_markers) for key, value in os.environ.items())
result['fixture_matches'] = result['fixture_sha256'] == expected
print(json.dumps(result, separators=(',', ':'), sort_keys=True))
"""


SCAN_SCRIPT = r"""
import hashlib, json, os, stat, sys

root = '/sandbox'
max_files, max_file_bytes, max_total_bytes, max_log_bytes = map(int, sys.argv[1:])
def safe_relative(relative):
    try:
        encoded = relative.encode('utf-8', errors='strict')
    except UnicodeError:
        raise RuntimeError('output path is not valid UTF-8')
    if (not encoded or len(encoded) > 4096 or os.path.isabs(relative) or
            os.path.normpath(relative) != relative or '\\' in relative or
            any(byte < 32 or byte == 127 for byte in encoded)):
        raise RuntimeError('unsafe output path')
    return relative
def file_fact(path, relative, limit):
    safe_relative(relative)
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        raise RuntimeError('non-regular output: ' + relative)
    if before.st_size > limit:
        raise RuntimeError('output exceeds per-file limit: ' + relative)
    hasher = hashlib.sha256()
    with open(path, 'rb', buffering=0) as handle:
        while True:
            chunk = handle.read(65536)
            if not chunk:
                break
            hasher.update(chunk)
    after = os.lstat(path)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise RuntimeError('output changed while hashing: ' + relative)
    return {'path': relative, 'sizeBytes': before.st_size, 'sha256': 'sha256:' + hasher.hexdigest()}

files = []
entries = 0
stack = [os.path.join(root, 'work')]
while stack:
    directory = stack.pop()
    for entry in sorted(os.scandir(directory), key=lambda item: os.fsencode(item.name)):
        entries += 1
        if entries > max_files * 4 + 256:
            raise RuntimeError('output directory entry limit exceeded')
        path = entry.path
        relative = safe_relative(os.path.relpath(path, os.path.join(root, 'work')))
        metadata = entry.stat(follow_symlinks=False)
        if stat.S_ISDIR(metadata.st_mode):
            stack.append(path)
        elif stat.S_ISREG(metadata.st_mode):
            if relative == '_miniwdl_inputs' or relative.startswith('_miniwdl_inputs' + os.sep):
                if metadata.st_size != 0:
                    raise RuntimeError('non-empty underlying input placeholder rejected: ' + relative)
                continue
            files.append(file_fact(path, relative, max_file_bytes))
            if len(files) > max_files:
                raise RuntimeError('output artifact count limit exceeded')
        else:
            raise RuntimeError('symlink or special output rejected: ' + relative)

logs = {}
for name in ('stdout', 'stderr'):
    path = os.path.join(root, name + '.txt')
    logs[name] = file_fact(path, name + '.txt', max_log_bytes)

total = sum(item['sizeBytes'] for item in files) + sum(item['sizeBytes'] for item in logs.values())
if total > max_total_bytes:
    raise RuntimeError('total output byte limit exceeded')
files.sort(key=lambda item: os.fsencode(item['path']))
manifest = {'files': files, 'logs': logs, 'totalBytes': total}
manifest['manifestDigest'] = 'sha256:' + hashlib.sha256(('dsh-bio-output-manifest-v1\n' + json.dumps(manifest, separators=(',', ':'), sort_keys=True)).encode()).hexdigest()
print(json.dumps(manifest, separators=(',', ':'), sort_keys=True))
"""


def scan_host_tree(
    work: str,
    stdout_path: str,
    stderr_path: str,
    *,
    max_files: int,
    max_file_bytes: int,
    max_total_bytes: int,
    max_log_bytes: int,
) -> Dict[str, Any]:
    def safe_relative(path: str) -> str:
        try:
            encoded = path.encode("utf-8", errors="strict")
        except UnicodeError as exn:
            raise RunnerError("copied output path is not valid UTF-8") from exn
        if (
            not encoded
            or len(encoded) > 4096
            or os.path.isabs(path)
            or os.path.normpath(path) != path
            or "\\" in path
            or any(byte < 32 or byte == 127 for byte in encoded)
        ):
            raise RunnerError("copied output path is unsafe")
        return path

    def file_fact(path: str, relative_path: str, limit: int) -> Dict[str, Any]:
        safe_relative(relative_path)
        before = os.lstat(path)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise RunnerError("copied output is unsafe or exceeds its limit: " + relative_path)
        hasher = hashlib.sha256()
        with open(path, "rb", buffering=0) as handle:
            while chunk := handle.read(65536):
                hasher.update(chunk)
        after = os.lstat(path)
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise RunnerError("copied output changed while hashing: " + relative_path)
        return {
            "path": relative_path,
            "sizeBytes": before.st_size,
            "sha256": "sha256:" + hasher.hexdigest(),
        }

    files: List[Dict[str, Any]] = []
    entries = 0
    stack = [work]
    while stack:
        directory = stack.pop()
        with os.scandir(directory) as iterator:
            children = sorted(iterator, key=lambda item: os.fsencode(item.name))
        for entry in children:
            entries += 1
            if entries > max_files * 4 + 256:
                raise RunnerError("copied output directory entry limit exceeded")
            relative_path = safe_relative(os.path.relpath(entry.path, work))
            metadata = entry.stat(follow_symlinks=False)
            if stat.S_ISDIR(metadata.st_mode):
                stack.append(entry.path)
            elif stat.S_ISREG(metadata.st_mode):
                if relative_path == "_miniwdl_inputs" or relative_path.startswith("_miniwdl_inputs" + os.sep):
                    if metadata.st_size != 0:
                        raise RunnerError("non-empty copied input placeholder rejected: " + relative_path)
                    continue
                files.append(file_fact(entry.path, relative_path, max_file_bytes))
                if len(files) > max_files:
                    raise RunnerError("copied output artifact count limit exceeded")
            else:
                raise RunnerError("copied symlink or special output rejected: " + relative_path)
    logs = {
        "stdout": file_fact(stdout_path, "stdout.txt", max_log_bytes),
        "stderr": file_fact(stderr_path, "stderr.txt", max_log_bytes),
    }
    total = sum(item["sizeBytes"] for item in files) + sum(item["sizeBytes"] for item in logs.values())
    if total > max_total_bytes:
        raise RunnerError("copied total output byte limit exceeded")
    files.sort(key=lambda item: os.fsencode(item["path"]))
    manifest: Dict[str, Any] = {"files": files, "logs": logs, "totalBytes": total}
    manifest["manifestDigest"] = "sha256:" + hashlib.sha256(
        ("dsh-bio-output-manifest-v1\n" + stable_json(manifest)).encode("utf-8")
    ).hexdigest()
    return manifest


def append_evidence(path: str, event: Dict[str, Any]) -> None:
    encoded = (stable_json(event) + "\n").encode("utf-8")
    if len(encoded) > 64 * 1024:
        raise RunnerError("runner evidence event exceeds 65536 bytes")
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.geteuid():
            raise RunnerError("runner evidence path is not a user-owned regular file")
        if metadata.st_size + len(encoded) > MAX_EVIDENCE_BYTES:
            raise RunnerError("runner evidence exceeds its aggregate byte limit")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        if os.write(descriptor, encoded) != len(encoded):
            raise RunnerError("runner evidence append was incomplete")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def version_document(runtime: Dict[str, Any]) -> Dict[str, Any]:
    path = os.path.realpath(__file__)
    wrapper_digest, wrapper_size = file_sha256(path)
    miniwdl = next(
        (item for item in runtime["distributions"] if item["name"] == "miniwdl"),
        None,
    )
    if miniwdl is None:
        raise RunnerError("miniwdl is absent from the verified dependency closure")
    return {
        "backend": BACKEND_NAME,
        "policyVersion": POLICY_VERSION,
        "expectedMiniwdlVersion": EXPECTED_MINIWDL_VERSION,
        "miniwdlVersion": miniwdl["version"],
        "pythonVersion": ".".join(map(str, sys.version_info[:3])),
        "controllerNetwork": controller_network_filter_identity(),
        "wrapper": {"sha256": wrapper_digest, "sizeBytes": wrapper_size},
        "pythonEnvironment": runtime,
    }


def bootstrap_verified_miniwdl() -> Tuple[Dict[str, Any], Dict[str, Any]]:
    global WDL, _, config, task_container, SubprocessBase, _SITE_PACKAGES
    site_packages, _ = isolated_site_packages()
    runtime = python_environment_identity(site_packages)
    version = version_document(runtime)
    if len(sys.argv) == 2 and sys.argv[1] == "--dsh-version":
        print(stable_json(version))
        raise SystemExit(0)
    if version["miniwdlVersion"] != EXPECTED_MINIWDL_VERSION:
        raise RunnerError(
            f"miniwdl version mismatch: expected {EXPECTED_MINIWDL_VERSION}, "
            f"found {version['miniwdlVersion']}"
        )
    guard = read_guard_config()
    await_launch_gate(guard)
    docker_broker = start_docker_broker(guard)
    try:
        controller = apply_controller_guards(
            guard,
            runtime,
            version["wrapper"]["sha256"],
            docker_broker,
        )
    except BaseException:
        stop_docker_broker()
        raise
    try:
        # Python -S prevents .pth, sitecustomize, and usercustomize execution. Only the verified
        # environment directory is appended after its complete miniwdl dependency closure is hashed.
        sys.path.append(site_packages)
        _SITE_PACKAGES = site_packages
        WDL = importlib.import_module("WDL")
        _ = importlib.import_module("WDL._util").StructuredLogMessage
        config = importlib.import_module("WDL.runtime.config")
        task_container = importlib.import_module("WDL.runtime.task_container")
        SubprocessBase = importlib.import_module(
            "WDL.runtime.backend.cli_subprocess"
        ).SubprocessBase
    except BaseException:
        stop_controller_host_canary()
        raise
    return guard, controller


try:
    _BOOTSTRAP_GUARD, _CONTROLLER_BASIS = bootstrap_verified_miniwdl()
except RunnerError as exn:
    logging.getLogger("dsh-fixture-runner").error(str(exn))
    raise SystemExit(2)


class DshFixtureDockerContainer(SubprocessBase):
    """miniwdl task backend with no production runner or allowlist authority."""

    _docker: str
    _support_image: Dict[str, str]
    _uid: int
    _gid: int
    _file_io_root: str
    _test_root: str
    _fixture_root: str
    _fixture_data_root: str
    _test_id: str
    _plan_digest: str
    _budgets: Dict[str, int]
    _task_counter = 0
    _artifact_counter = 0
    _output_bytes = 0
    _log_bytes = 0
    _task_counter_lock = threading.Lock()

    @classmethod
    def global_init(cls, cfg: config.Loader, logger: logging.Logger) -> None:
        if sys.platform != "linux" or os.geteuid() == 0:
            raise RunnerError("isolated fixture runner requires Linux and a non-root controller user")
        cls._docker = cfg.get("dsh_fixture_docker", "docker_executable")
        if not os.path.isabs(cls._docker) or not SAFE_HOST_PATH.fullmatch(cls._docker):
            raise RunnerError("isolated fixture runner requires an absolute safe Docker executable path")
        cls._file_io_root = os.path.realpath(cfg.get("file_io", "root"))
        if (
            not os.path.isdir(cls._file_io_root)
            or not SAFE_HOST_PATH.fullmatch(cls._file_io_root)
        ):
            raise RunnerError("isolated fixture runner file-I/O root is unsafe")
        cls._test_root = os.path.realpath(cfg.get("dsh_fixture_docker", "test_root"))
        cls._fixture_root = os.path.realpath(cfg.get("dsh_fixture_docker", "fixture_root"))
        cls._fixture_data_root = os.path.realpath(
            cfg.get("dsh_fixture_docker", "fixture_data_root")
        )
        if (
            cls._file_io_root != cls._fixture_root
            or not os.path.isdir(cls._test_root)
            or not os.path.isdir(cls._fixture_root)
            or not os.path.isdir(cls._fixture_data_root)
            or os.path.dirname(cls._fixture_data_root) != cls._fixture_root
        ):
            raise RunnerError("isolated fixture runner roots do not match the approved snapshots")
        cls._test_id = cfg.get("dsh_fixture_docker", "test_id")
        cls._plan_digest = cfg.get("dsh_fixture_docker", "plan_digest")
        if not TEST_ID.fullmatch(cls._test_id) or not DIGEST.fullmatch(cls._plan_digest):
            raise RunnerError("isolated fixture resource ownership identity is invalid")
        cls._budgets = configured_budgets(cfg)
        cls._task_counter = 0
        cls._artifact_counter = 0
        cls._output_bytes = 0
        cls._log_bytes = 0
        if cfg.get("task_runtime", "command_shell") != "/bin/bash":
            raise RunnerError("isolated fixture runner requires the fixed /bin/bash command shell")
        allowed_images = cfg.get_list("dsh_fixture_docker", "allowed_images")
        if (
            len(allowed_images) != 1
            or not isinstance(allowed_images[0], str)
            or not PINNED_IMAGE.fullmatch(allowed_images[0])
        ):
            raise RunnerError("isolated fixture runner requires one exact approved task image")
        support_reference = cfg.get("dsh_fixture_docker", "support_image")
        cls._uid = os.geteuid()
        cls._gid = os.getegid()
        cls._support_image = image_identity(cls._docker, support_reference)

        evidence_path = validate_bind_source(
            cfg.get("dsh_fixture_docker", "evidence_path"),
            cls._test_root,
        )
        if not stat.S_ISREG(os.lstat(evidence_path).st_mode):
            raise RunnerError("runner evidence path must be a regular file")
        validate_bind_source(
            cfg.get("dsh_fixture_docker", "probe_canary_path"),
            cls._test_root,
        )

        info = run_bounded(
            [
                cls._docker,
                "info",
                "--format",
                "{{.ID}}\t{{.ServerVersion}}\t{{.CgroupVersion}}\t{{json .SecurityOptions}}",
            ]
        ).stdout.strip().split("\t", 3)
        if len(info) != 4 or not info[0] or not info[1] or info[2] != "2":
            raise RunnerError("Docker isolation prerequisites require an identified cgroup v2 daemon")
        try:
            security_options = set(json.loads(info[3]))
        except json.JSONDecodeError as exn:
            raise RunnerError("Docker security options probe returned invalid JSON") from exn
        if "name=seccomp,profile=builtin" not in security_options or "name=apparmor" not in security_options:
            raise RunnerError("Docker builtin seccomp and AppArmor are required")

        cls.detect_resource_limits(cfg, logger)
        cls._run_isolation_probe(cfg, logger, {
            "engineId": info[0],
            "serverVersion": info[1],
            "cgroupVersion": info[2],
            "securityOptions": sorted(security_options),
        })
        logger.notice(
            _(
                "isolated fixture Docker backend initialized",
                policy_version=POLICY_VERSION,
                docker_server=info[1],
                support_image=support_reference,
            )
        )

    @classmethod
    def _run_isolation_probe(
        cls,
        cfg: config.Loader,
        logger: logging.Logger,
        daemon: Dict[str, Any],
    ) -> None:
        token = uuid.uuid4().hex
        name = "dshbio-probe-" + token[:20]
        canary_path = cfg.get("dsh_fixture_docker", "probe_canary_path")
        evidence_path = cfg.get("dsh_fixture_docker", "evidence_path")
        expected_canary = cfg.get("dsh_fixture_docker", "probe_canary_digest")
        cpu = cls._budgets["cpu"]
        memory = cls._budgets["memory_bytes"]
        pids = cls._budgets["pids"]
        tmp_bytes = min(16 * 1024 * 1024, cls._budgets["total_output_bytes"])
        file_bytes = cls._budgets["artifact_bytes"]
        uid_gid = f"{cls._uid}:{cls._gid}"
        try:
            with contextlib.nullcontext(controller_host_canary()) as canary:
                canary_path = validate_bind_source(canary_path, cls._test_root)
                argv = common_container_args(
                    cls._docker,
                    name=name,
                    token=token,
                    test_id=cls._test_id,
                    plan_digest=cls._plan_digest,
                    uid=cls._uid,
                    gid=cls._gid,
                    cpu=cpu,
                    memory=memory,
                    pids=pids,
                    tmp_bytes=tmp_bytes,
                    file_bytes=file_bytes,
                    image_environment_keys=cls._support_image["environmentKeys"],
                )
                argv += [
                    "--mount",
                    f"type=bind,src={canary_path},dst=/fixture/canary,readonly,bind-recursive=disabled",
                    "--entrypoint",
                    "python3",
                    cls._support_image["reference"],
                    "-I",
                    "-c",
                    PROBE_SCRIPT,
                    str(canary.port),
                    expected_canary,
                ]
                container_id = create_owned_container(
                    cls._docker, argv, name, token, cls._test_id, cls._plan_digest
                )
                inspected = validate_container_facts(
                    inspect_container(cls._docker, container_id),
                    token=token,
                    image=cls._support_image,
                    uid_gid=uid_gid,
                    cpu=cpu,
                    memory=memory,
                    pids=pids,
                    tmp_bytes=tmp_bytes,
                    file_bytes=file_bytes,
                    expected_mounts=[expected_bind_mount(canary_path, "/fixture/canary")],
                )
                started = run_bounded(
                    [cls._docker, "container", "start", "--attach", container_id],
                    timeout=30.0,
                    check=False,
                )
                if started.returncode != 0:
                    raise RunnerError("isolation probe container failed")
                lines = [line for line in started.stdout.splitlines() if line.strip()]
                if len(lines) != 1:
                    raise RunnerError("isolation probe emitted an invalid bounded result")
                try:
                    observed = json.loads(lines[0])
                except json.JSONDecodeError as exn:
                    raise RunnerError("isolation probe emitted invalid JSON") from exn
                expected = {
                    "loopback_positive": True,
                    "interfaces": ["lo"],
                    "host_loopback": 111,
                    "egress": 101,
                    "bridge_gateway": 101,
                    "root_write": 30,
                    "tmpfs_write": True,
                    "fixture_sha256": expected_canary,
                    "cap_eff": "0000000000000000",
                    "no_new_privs": "1",
                    "docker_socket_absent": True,
                    "credential_paths_absent": True,
                    "ambient_credentials_absent": True,
                    "fixture_matches": True,
                }
                probes = []
                for key, expected_value in expected.items():
                    observed_value = observed.get(key)
                    probes.append(
                        {
                            "id": key,
                            "status": "passed" if observed_value == expected_value else "failed",
                            "expected": expected_value if not isinstance(expected_value, list) else stable_json(expected_value),
                            "observed": observed_value if not isinstance(observed_value, list) else stable_json(observed_value),
                        }
                    )
                host_isolated = canary.connections == 1
                probes.append(
                    {
                        "id": "host_canary_connections",
                        "status": "passed" if host_isolated else "failed",
                        "expected": 1,
                        "observed": canary.connections,
                    }
                )
                if any(item["status"] != "passed" for item in probes):
                    raise RunnerError("deterministic isolation denial probe failed")
                probe_basis = {
                    "policyVersion": POLICY_VERSION,
                    "daemon": daemon,
                    "supportImage": {
                        "reference": cls._support_image["reference"],
                        "imageId": cls._support_image["imageId"],
                    },
                    "containerConfigDigest": inspected["configDigest"],
                    "probes": probes,
                }
                append_evidence(
                    evidence_path,
                    {
                        "type": "isolation_probe",
                        **probe_basis,
                        "probeDigest": digest(probe_basis, "probe"),
                    },
                )
        finally:
            remove_owned_container(
                cls._docker, name, token, cls._test_id, cls._plan_digest
            )

    @property
    def cli_name(self) -> str:
        return BACKEND_NAME

    @property
    def cli_exe(self) -> List[str]:
        return [self._docker]

    def _run_invocation(
        self, logger: logging.Logger, cleanup: contextlib.ExitStack, image: str
    ) -> List[str]:
        raise RunnerError("direct invocation is disabled; isolated lifecycle is required")

    def process_runtime(self, logger: logging.Logger, runtime_eval: Dict[str, WDL.Value.Base]) -> None:
        super().process_runtime(logger, runtime_eval)
        forbidden = [
            key
            for key in ("inlineDockerfile", "docker_network", "privileged", "gpu")
            if key in self.runtime_values
        ]
        if forbidden:
            raise RunnerError("forbidden task runtime settings: " + ", ".join(forbidden))
        if self.runtime_values.get("maxRetries", 0) != 0 or self.runtime_values.get("preemptible", 0) != 0:
            raise RunnerError("isolated fixture tasks cannot request retries or preemptible replay")
        if "returnCodes" in self.runtime_values:
            raise RunnerError("isolated fixture tasks cannot override successful exit codes")
        image = self.runtime_values.get("docker")
        allowed = self.cfg.get_list("dsh_fixture_docker", "allowed_images")
        if image not in allowed or not isinstance(image, str) or not PINNED_IMAGE.fullmatch(image):
            raise RunnerError("task image is not the exact digest-pinned image in the approved plan")

    def _run(self, logger: logging.Logger, terminating: Callable[[], bool], command: str) -> int:
        if self.runtime_values.get("env"):
            raise RunnerError("isolated fixture tasks cannot receive environment-decorated inputs")
        with self._task_counter_lock:
            type(self)._task_counter += 1
            task_ordinal = type(self)._task_counter
        max_tasks = self._budgets["task_count"]
        if task_ordinal > max_tasks:
            raise RunnerError("isolated fixture task count limit exceeded")

        image_reference = self.runtime_values["docker"]
        task_image = image_identity(self._docker, image_reference)
        cpu = self._budgets["cpu"]
        memory = self._budgets["memory_bytes"]
        pids = self._budgets["pids"]
        task_time = self._budgets["task_time_ms"] / 1000.0
        log_bytes = self._budgets["log_bytes"]
        artifact_count = self._budgets["artifact_count"]
        artifact_bytes = self._budgets["artifact_bytes"]
        total_output_bytes = self._budgets["total_output_bytes"]
        tmp_bytes = min(16 * 1024 * 1024, total_output_bytes)
        evidence_path = self.cfg.get("dsh_fixture_docker", "evidence_path")
        uid_gid = f"{self._uid}:{self._gid}"

        token = uuid.uuid4().hex
        suffix = token[:20]
        volume_name = "dshbio-vol-" + suffix
        keeper_name = "dshbio-keep-" + suffix
        task_name = "dshbio-task-" + suffix
        command_path = os.path.join(self.host_dir, "command")
        command_path = validate_bind_source(os.path.dirname(command_path), self._test_root) + "/command"
        descriptor = os.open(
            command_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o400,
        )
        try:
            encoded_command = command.encode("utf-8")
            if os.write(descriptor, encoded_command) != len(encoded_command):
                raise RunnerError("isolated task command write was incomplete")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        container_id: Optional[str] = None
        inspected: Optional[Dict[str, Any]] = None
        event_written = False
        timed_out = False
        cancelled = False
        ambiguous = False
        try:
            create_tmpfs_volume(
                self._docker,
                volume_name,
                token,
                total_output_bytes,
                self._uid,
                self._gid,
                self._test_id,
                self._plan_digest,
            )
            output_storage = tmpfs_volume_identity(
                self._docker,
                volume_name,
                token,
                total_output_bytes,
                self._uid,
                self._gid,
            )
            volume_source = volume_mountpoint(self._docker, volume_name, token)
            keeper_argv = common_container_args(
                self._docker,
                name=keeper_name,
                token=token,
                test_id=self._test_id,
                plan_digest=self._plan_digest,
                uid=self._uid,
                gid=self._gid,
                cpu=1,
                memory=max(64 * 1024 * 1024, min(memory, 128 * 1024 * 1024)),
                pids=min(pids, 16),
                tmp_bytes=min(tmp_bytes, 1024 * 1024),
                file_bytes=artifact_bytes,
                image_environment_keys=self._support_image["environmentKeys"],
            )
            keeper_argv += [
                "--mount",
                f"type=volume,src={volume_name},dst=/sandbox,volume-nocopy",
                "--entrypoint",
                "/bin/sh",
                self._support_image["reference"],
                "-c",
                "mkdir -p /sandbox/work && : > /sandbox/.ready && exec sleep 86400",
            ]
            keeper_id = create_owned_container(
                self._docker,
                keeper_argv,
                keeper_name,
                token,
                self._test_id,
                self._plan_digest,
            )
            keeper_mounts = [expected_volume_mount(volume_name, volume_source, "/sandbox")]
            validate_container_facts(
                inspect_container(self._docker, keeper_id),
                token=token,
                image=self._support_image,
                uid_gid=uid_gid,
                cpu=1,
                memory=max(64 * 1024 * 1024, min(memory, 128 * 1024 * 1024)),
                pids=min(pids, 16),
                tmp_bytes=min(tmp_bytes, 1024 * 1024),
                file_bytes=artifact_bytes,
                expected_mounts=keeper_mounts,
            )
            started_keeper = run_bounded(
                [self._docker, "container", "start", keeper_id], check=False
            )
            if started_keeper.returncode != 0:
                ambiguous = True
                raise RunnerError("keeper start outcome was ambiguous")
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                ready = run_bounded(
                    [self._docker, "container", "exec", keeper_id, "test", "-f", "/sandbox/.ready"],
                    timeout=2.0,
                    check=False,
                )
                if ready.returncode == 0:
                    break
                time.sleep(0.05)
            else:
                raise RunnerError("bounded output keeper did not become ready")

            task_argv = common_container_args(
                self._docker,
                name=task_name,
                token=token,
                test_id=self._test_id,
                plan_digest=self._plan_digest,
                uid=self._uid,
                gid=self._gid,
                cpu=cpu,
                memory=memory,
                pids=pids,
                tmp_bytes=tmp_bytes,
                file_bytes=artifact_bytes,
                image_environment_keys=task_image["environmentKeys"],
            )
            task_argv += [
                "--mount",
                f"type=volume,src={volume_name},dst={CONTAINER_ROOT},volume-nocopy",
                "--mount",
                f"type=bind,src={command_path},dst={CONTAINER_ROOT}/command,readonly,bind-recursive=disabled",
            ]
            expected_mounts = [
                expected_volume_mount(volume_name, volume_source, CONTAINER_ROOT),
                expected_bind_mount(command_path, f"{CONTAINER_ROOT}/command"),
            ]
            seen_destinations = {CONTAINER_ROOT, f"{CONTAINER_ROOT}/command"}
            for host_path, container_path in sorted(self.input_path_map.items()):
                source = validate_bind_source(host_path.rstrip("/"), self._fixture_data_root)
                destination = validate_container_destination(container_path.rstrip("/"))
                if destination in seen_destinations:
                    raise RunnerError("Docker bind destination is duplicated")
                seen_destinations.add(destination)
                task_argv += [
                    "--mount",
                    f"type=bind,src={source},dst={destination},readonly,bind-recursive=disabled",
                ]
                expected_mounts.append(expected_bind_mount(source, destination))
            task_argv += [
                "--workdir",
                f"{CONTAINER_ROOT}/work",
                "--entrypoint",
                "/bin/sh",
                task_image["reference"],
                "-c",
                self.cfg.get("task_runtime", "command_shell")
                + " ../command >> ../stdout.txt 2>> ../stderr.txt",
            ]
            container_id = create_owned_container(
                self._docker,
                task_argv,
                task_name,
                token,
                self._test_id,
                self._plan_digest,
            )
            inspected = validate_container_facts(
                inspect_container(self._docker, container_id),
                token=token,
                image=task_image,
                uid_gid=uid_gid,
                cpu=cpu,
                memory=memory,
                pids=pids,
                tmp_bytes=tmp_bytes,
                file_bytes=artifact_bytes,
                expected_mounts=expected_mounts,
            )

            started = run_bounded(
                [self._docker, "container", "start", container_id],
                timeout=5.0,
                check=False,
            )
            if started.returncode != 0:
                ambiguous = True
                raise RunnerError("task container start outcome was ambiguous")
            started_at = time.monotonic()
            with self.task_running_context():
                while True:
                    if terminating() and not cancelled:
                        cancelled = True
                        run_bounded([self._docker, "container", "kill", container_id], check=False)
                    elif time.monotonic() - started_at >= task_time and not timed_out:
                        timed_out = True
                        run_bounded([self._docker, "container", "kill", container_id], check=False)
                    running = run_bounded(
                        [
                            self._docker,
                            "container",
                            "inspect",
                            "--format",
                            "{{.State.Running}}",
                            container_id,
                        ],
                        timeout=2.0,
                        check=False,
                    )
                    if running.returncode != 0:
                        ambiguous = True
                        raise RunnerError("task container running state was ambiguous")
                    if running.stdout.strip().lower() == "false":
                        break
                    if running.stdout.strip().lower() != "true":
                        ambiguous = True
                        raise RunnerError("task container running state was invalid")
                    time.sleep(0.2)
            state_result = run_bounded(
                [
                    self._docker,
                    "container",
                    "inspect",
                    "--format",
                    "{{.State.ExitCode}}\t{{.State.OOMKilled}}\t{{.State.Running}}\t{{.State.Error}}",
                    container_id,
                ]
            )
            state = state_result.stdout.rstrip("\n").split("\t", 3)
            if len(state) != 4 or not state[0].isdigit():
                ambiguous = True
                raise RunnerError("task exit status was ambiguous")
            if state[2].lower() == "true":
                ambiguous = True
                run_bounded([self._docker, "container", "kill", container_id], check=False)
                raise RunnerError("task remained active after bounded lifecycle polling")
            exit_code = int(state[0])
            if timed_out:
                self.failure_info = {"code": "task_timeout", "automaticRetry": False}
                exit_code = exit_code or 124
            elif cancelled:
                self.failure_info = {"code": "task_cancelled", "automaticRetry": False}
            elif state[1].lower() == "true":
                self.failure_info = {"code": "task_memory_limit", "automaticRetry": False}

            scan = run_bounded(
                [
                    self._docker,
                    "container",
                    "exec",
                    keeper_id,
                    "python3",
                    "-I",
                    "-c",
                    SCAN_SCRIPT,
                    str(artifact_count),
                    str(artifact_bytes),
                    str(total_output_bytes),
                    str(log_bytes),
                ],
                timeout=30.0,
            )
            try:
                manifest = json.loads(scan.stdout)
            except json.JSONDecodeError as exn:
                raise RunnerError("trusted output scanner emitted invalid JSON") from exn
            task_files = len(manifest.get("files", []))
            task_output_bytes = manifest.get("totalBytes")
            task_log_bytes = sum(
                item.get("sizeBytes", -1)
                for item in manifest.get("logs", {}).values()
                if isinstance(item, dict)
            )
            if (
                not isinstance(task_output_bytes, int)
                or task_output_bytes < 0
                or task_log_bytes < 0
            ):
                raise RunnerError("trusted output scanner returned invalid aggregate counters")
            with self._task_counter_lock:
                next_artifacts = type(self)._artifact_counter + task_files
                next_output_bytes = type(self)._output_bytes + task_output_bytes
                next_log_bytes = type(self)._log_bytes + task_log_bytes
                if next_artifacts > artifact_count:
                    raise RunnerError("workflow artifact count budget exceeded")
                if next_output_bytes > total_output_bytes:
                    raise RunnerError("workflow total output byte budget exceeded")
                if next_log_bytes > log_bytes:
                    raise RunnerError("workflow log byte budget exceeded")
                type(self)._artifact_counter = next_artifacts
                type(self)._output_bytes = next_output_bytes
                type(self)._log_bytes = next_log_bytes
            os.makedirs(self.host_work_dir(), exist_ok=True)
            if os.listdir(self.host_work_dir()):
                raise RunnerError("host task work directory was not empty before bounded copy-out")
            stdout_path = self.host_stdout_txt()
            stderr_path = self.host_stderr_txt()
            if os.path.lexists(stdout_path) or os.path.lexists(stderr_path):
                raise RunnerError("host task log paths unexpectedly exist before bounded copy-out")
            run_bounded(
                [self._docker, "container", "cp", f"{keeper_id}:/sandbox/work/.", self.host_work_dir()],
                timeout=30.0,
            )
            run_bounded(
                [self._docker, "container", "cp", f"{keeper_id}:/sandbox/stdout.txt", stdout_path],
                timeout=30.0,
            )
            run_bounded(
                [self._docker, "container", "cp", f"{keeper_id}:/sandbox/stderr.txt", stderr_path],
                timeout=30.0,
            )
            copied = scan_host_tree(
                self.host_work_dir(),
                stdout_path,
                stderr_path,
                max_files=artifact_count,
                max_file_bytes=artifact_bytes,
                max_total_bytes=total_output_bytes,
                max_log_bytes=log_bytes,
            )
            if copied != manifest:
                raise RunnerError("bounded output changed between trusted scan and host copy-out")

            container_controls = public_container_controls(
                inspected,
                output_storage_digest=output_storage["storageDigest"],
            )
            event_basis = {
                "type": "task",
                "task": bounded_text(self.run_id, 256),
                "taskOrdinal": task_ordinal,
                "image": image_reference,
                "imageId": task_image["imageId"],
                "containerConfigDigest": inspected["configDigest"],
                "containerControls": container_controls,
                "containerControlsDigest": digest(container_controls, "container-controls"),
                "outputManifestDigest": manifest["manifestDigest"],
                "exitCode": exit_code,
                "timedOut": timed_out,
                "cancelled": cancelled,
                "ambiguous": ambiguous,
            }
            append_evidence(
                evidence_path,
                {**event_basis, "eventDigest": digest(event_basis, "task-event")},
            )
            event_written = True
            logger.info(
                _(
                    "isolated fixture task completed",
                    task_ordinal=task_ordinal,
                    exit_code=exit_code,
                    output_manifest=manifest["manifestDigest"],
                )
            )
            return exit_code
        except Exception:
            if container_id is not None:
                run_bounded([self._docker, "container", "kill", container_id], check=False)
            if not event_written:
                failure_code = (
                    "task_launch_ambiguous"
                    if ambiguous
                    else "task_cancelled"
                    if cancelled
                    else "task_timeout"
                    if timed_out
                    else "task_backend_failed"
                )
                failure_basis = {
                    "type": "task_failure",
                    "task": bounded_text(self.run_id, 256),
                    "taskOrdinal": task_ordinal,
                    "image": image_reference,
                    "imageId": task_image["imageId"],
                    "containerConfigDigest": None if inspected is None else inspected["configDigest"],
                    "code": failure_code,
                    "timedOut": timed_out,
                    "cancelled": cancelled,
                    "ambiguous": ambiguous,
                    "automaticRetry": False,
                }
                append_evidence(
                    evidence_path,
                    {
                        **failure_basis,
                        "failureFingerprint": digest(failure_basis, "task-failure"),
                    },
                )
            raise
        finally:
            remove_owned_container(
                self._docker, task_name, token, self._test_id, self._plan_digest
            )
            remove_owned_container(
                self._docker, keeper_name, token, self._test_id, self._plan_digest
            )
            remove_owned_volume(
                self._docker, volume_name, token, self._test_id, self._plan_digest
            )


def main() -> int:
    if _BOOTSTRAP_GUARD is None or _CONTROLLER_BASIS is None:
        raise RunnerError("isolated controller bootstrap identity is unavailable")
    guard = _BOOTSTRAP_GUARD
    try:
        import WDL.CLI

        WDL.CLI.make_read_source = lambda _no_outside_imports: local_only_read_source_factory(
            guard["wdlRoot"], (guard["inputsPath"],)
        )
        # Pre-populating the version-pinned backend registry prevents discovery or selection of any
        # ambient container backend entry point in this dedicated process.
        task_container._backends.clear()
        task_container._backends[BACKEND_NAME] = DshFixtureDockerContainer
        result = WDL.CLI.main()
        return 0 if result is None else int(result)
    finally:
        stop_controller_host_canary()
        stop_docker_broker()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RunnerError as exn:
        logging.getLogger("dsh-fixture-runner").error(str(exn))
        raise SystemExit(2)
