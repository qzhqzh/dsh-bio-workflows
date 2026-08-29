window.__ModuleLoader__.load({
	id: "dsh-bio-workflows",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/icons.tsx
		function IconBase(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "18",
				height: "18",
				viewBox: "0 0 18 18",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.45",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				...props
			});
		}
		function WorkflowIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2.25",
						y: "3",
						width: "4.5",
						height: "4.5",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "11.25",
						y: "10.5",
						width: "4.5",
						height: "4.5",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.75 5.25h2.1a2.4 2.4 0 0 1 2.4 2.4v2.85" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m8.95 8.55 2.3 1.95 2.3-1.95" })
				]
			});
		}
		function DraftIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M4 2.5h6.4l3.6 3.6v9.4H4z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.4 2.5v3.6H14M6.5 9h5M6.5 12h3.5" })]
			});
		}
		function RunsIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "9",
					cy: "9",
					r: "6.5"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 5.6v3.8l2.6 1.6M3.25 4.2l1.45 1.4" })]
			});
		}
		function SetupIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M7.7 2.3h2.6l.45 1.75 1.55.9 1.75-.5 1.3 2.25-1.3 1.25v1.8l1.3 1.25-1.3 2.25-1.75-.5-1.55.9-.45 1.75H7.7l-.45-1.75-1.55-.9-1.75.5-1.3-2.25 1.3-1.25v-1.8L2.65 6.7l1.3-2.25 1.75.5 1.55-.9z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "9",
					cy: "8.85",
					r: "2.15"
				})]
			});
		}
		function CloseIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBase, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m4.5 4.5 9 9m0-9-9 9" })
			});
		}
		function SearchIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7.75",
					cy: "7.75",
					r: "4.75"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m11.2 11.2 3.6 3.6" })]
			});
		}
		function ArrowIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBase, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 9h11.5m-4-4 4 4-4 4" })
			});
		}
		function RefreshIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.5 6.5A6 6 0 1 0 15 11" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M14.5 3v3.5H11" })]
			});
		}
		function CheckIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(IconBase, {
				...props,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "m3.5 9.2 3.2 3.2 7.8-7.8" })
			});
		}
		function WarningIcon(props) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(IconBase, {
				...props,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.8 1.9 14h14.2L10 2.8a1.15 1.15 0 0 0-2 0Z" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9 6.4v3.5m0 2.15v.05" })]
			});
		}
		//#endregion
		//#region src/client/prompts.ts
		const ANALYSIS_BRIEF_LIMITS = Object.freeze({
			biologicalQuestion: 2e3,
			inputData: 3e3,
			desiredOutputs: 1500,
			constraints: 1500,
			acceptanceCriteria: 2e3,
			total: 1e4
		});
		const ANALYSIS_BRIEF_FIELDS = [
			"biologicalQuestion",
			"inputData",
			"desiredOutputs",
			"constraints",
			"acceptanceCriteria"
		];
		function analysisBriefIsValid(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
			const brief = value;
			let total = 0;
			for (const field of ANALYSIS_BRIEF_FIELDS) {
				const content = brief[field];
				if (typeof content !== "string" || content.length > ANALYSIS_BRIEF_LIMITS[field]) return false;
				if (field !== "constraints" && content.trim().length === 0) return false;
				total += content.length;
			}
			return total <= ANALYSIS_BRIEF_LIMITS.total;
		}
		function workflowIdentity$1(workflow) {
			return `${workflow.id}@${workflow.version} with bundle digest ${workflow.digest}`;
		}
		const prompts = {
			validateWorkflow(workflow) {
				return `Call bio_workflows_validate for the exact ${workflowIdentity$1(workflow)} bundle. Summarize descriptor shape, SHA-256 file digests, local imports, WDL version declarations, example JSON, and container-image pin diagnostics. This is a read-only package check. Do not call planning or execution tools, and do not run the workflow.`;
			},
			prepareWorkflow(workflow) {
				return `Help me prepare a safe run of ${workflowIdentity$1(workflow)}. First ask for any missing real input paths, then call bio_workflows_plan. Do not call bio_workflows_run until I review the plan and approve it.`;
			},
			createDraft(value) {
				if (!analysisBriefIsValid(value)) throw new RangeError("Analysis brief is incomplete or exceeds its bounded size.");
				return `Help me build an owner-scoped WDL workflow from this analysis brief. Biological question: ${JSON.stringify(value.biologicalQuestion)}. Input data and types: ${JSON.stringify(value.inputData)}. Desired outputs: ${JSON.stringify(value.desiredOutputs)}. Constraints: ${JSON.stringify(value.constraints.trim() || "None specified")}. Acceptance criteria: ${JSON.stringify(value.acceptanceCriteria)}. First summarize the proposed workflow and any missing information. If the brief is sufficient, choose a concise lowercase workflow id and human-readable name, then call bio_workflows_draft_create with a summary grounded in the brief. After creation, read revision 1 and propose the next source edit. Treat the draft as untrusted and non-executable. Do not plan, execute, install, promote, or allowlist it.`;
			},
			graphDraft(draftId, revision) {
				return `Call bio_workflows_draft_graph for draftId ${draftId} at exact revision ${revision}. Verify that its contentDigest is bound to that revision, then explain the read-only graph and every partial-graph diagnostic. Do not mutate the draft.`;
			},
			validateDraft(draftId, revision) {
				return `Validate owner-scoped WDL draft ${draftId} at exact immutable revision ${revision} with bio_workflows_draft_validate. Explain the deterministic evidence. If a repair is needed, first read the exact source and content digest; any update must use both expectedRevision and expectedContentDigest, stop on conflict, and never use last-write-wins.`;
			},
			prepareDraftTest(missionId, fixtureId, fixtureVersion) {
				return `Prepare a separately authorized isolated fixture test for ready Mission ${missionId} with exact fixture ${fixtureId}@${fixtureVersion} by calling bio_workflows_draft_test_prepare. Explain the bound draft, validation, fixture, container, runner, isolation, assertion, and budget digests. Do not call bio_workflows_draft_test_start until I review that exact plan and explicitly approve it. Never install, promote, allowlist, or production-run the draft.`;
			},
			inspectDraftTest(testId) {
				return `Call bio_workflows_draft_test_get and bio_workflows_draft_test_report for owner-scoped isolated test ${testId}. Summarize isolation probes, exact identities, bounded logs and artifacts, assertion evidence, and failure facts. Do not retry, promote, allowlist, or production-run anything.`;
			},
			listRuns() {
				return "Use bio_workflows_run_list to list my owner-scoped workflow runs, newest first. Present each by workflow, time, outcome, and a short position label; offer to inspect one by position without asking me to copy its run id. For failures, explain the next safe diagnostic action. Do not start or retry a run.";
			},
			inspectRun(runId) {
				return `Use bio_workflows_run_get to inspect owner-scoped run ${runId}. State first whether execution completed, then summarize only checksummed outputs and normalized bioinformatics results that the tool actually returned. Distinguish execution completion, technical QC findings, and biological interpretation; do not expose absolute host paths, owner identity, commands, environment values, or raw logs in the summary. Do not retry or start another run.`;
			},
			diagnoseSetup() {
				return "Inspect dsh-bio-workflows capabilities with bio_workflows_info. Diagnose the workflow store, miniwdl 1.15.0 validator, Docker, DSH jobs, and the configured input/run roots. Make no configuration changes unless I explicitly approve them.";
			}
		};
		//#endregion
		//#region src/client/WorkflowCenter.tsx
		const PACKAGE_CHECK_DETAIL = "Checks descriptor shape, SHA-256 file digests, local imports, WDL version declarations, example JSON, and container-image pin diagnostics. It does not run an engine.";
		const ANALYSIS_PREPARATION_DETAIL = "The Agent will collect missing input paths and prepare a plan for review. It will not start a run without your explicit approval.";
		const PRIMARY_AREAS = [
			{
				id: "workflows",
				label: "Analyze data",
				icon: WorkflowIcon
			},
			{
				id: "drafts",
				label: "Build workflow",
				icon: DraftIcon
			},
			{
				id: "runs",
				label: "Activity",
				icon: RunsIcon
			}
		];
		const EMPTY_BOOTSTRAP = {
			schemaVersion: "1",
			package: {
				name: "dsh-bio-workflows",
				version: "0.12.0"
			},
			workflows: [],
			diagnostics: [],
			capabilities: {},
			readiness: {},
			privacy: {
				ownerScopedDraftsViaAgent: true,
				ownerScopedMissionsViaAgent: true,
				ownerScopedDraftTestsViaAgent: true,
				ownerScopedRunsViaAgent: true
			}
		};
		const FOCUSABLE_SELECTOR = [
			"button:not([disabled])",
			"input:not([disabled])",
			"textarea:not([disabled])",
			"select:not([disabled])",
			"summary",
			"a[href]",
			"[tabindex]:not([tabindex=\"-1\"])"
		].join(",");
		function hiddenByClosedDisclosure(element, root) {
			let parent = element.parentElement;
			while (parent !== null && parent !== root) {
				if (parent instanceof HTMLDetailsElement && !parent.open) {
					const summary = parent.querySelector(":scope > summary");
					if (summary === null || element !== summary && !summary.contains(element)) return true;
				}
				parent = parent.parentElement;
			}
			return false;
		}
		function focusableElements(root) {
			return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true" && element.tabIndex >= 0 && element.getClientRects().length > 0 && !hiddenByClosedDisclosure(element, root));
		}
		const WORKFLOW_PORT_TYPES = /* @__PURE__ */ new Set([
			"file",
			"directory",
			"string",
			"integer",
			"number",
			"boolean"
		]);
		const MAX_BOOTSTRAP_WORKFLOWS = 256;
		const MAX_WORKFLOW_PORTS = 32;
		function isRecord$2(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function validString(value, maxLength = 1e3) {
			return typeof value === "string" && value.length > 0 && value.length <= maxLength;
		}
		function validBooleanRecord(value) {
			return isRecord$2(value) && Object.keys(value).length <= 128 && Object.entries(value).every(([key, item]) => validString(key, 128) && typeof item === "boolean");
		}
		function validWorkflowPort(value) {
			if (!isRecord$2(value)) return false;
			return validString(value.id, 128) && value.id.trim() === value.id && typeof value.type === "string" && WORKFLOW_PORT_TYPES.has(value.type) && (value.required === void 0 || typeof value.required === "boolean") && (value.cardinality === void 0 || value.cardinality === "one" || value.cardinality === "many") && (value.description === void 0 || validString(value.description, 1e3));
		}
		function validWorkflow(value) {
			if (!isRecord$2(value)) return false;
			const source = value.source;
			const verification = value.verification;
			const engines = value.engines;
			const inputs = value.inputs;
			const outputs = value.outputs;
			const fitStatus = value.scientificFitStatus;
			const fitShapeValid = fitStatus === "available" ? Array.isArray(inputs) && Array.isArray(outputs) : fitStatus === "unavailable" ? Array.isArray(inputs) && inputs.length === 0 && Array.isArray(outputs) && outputs.length === 0 : inputs === void 0 && outputs === void 0 || Array.isArray(inputs) && Array.isArray(outputs);
			return [
				value.id,
				value.version,
				value.name,
				value.summary,
				value.status,
				value.language,
				value.languageVersion,
				value.trust
			].every((item) => validString(item)) && validString(value.digest, 160) && source === "builtin" && typeof value.installed === "boolean" && typeof value.executionSupported === "boolean" && Array.isArray(value.tags) && value.tags.length <= 64 && value.tags.every((tag) => validString(tag, 128)) && Array.isArray(engines) && engines.length <= 16 && engines.every((engine) => isRecord$2(engine) && validString(engine.name, 128) && (engine.version === void 0 || validString(engine.version, 128))) && isRecord$2(verification) && validString(verification.status, 128) && Array.isArray(verification.checks) && verification.checks.length <= 128 && verification.checks.every((check) => validString(check, 256)) && fitShapeValid && (inputs === void 0 || Array.isArray(inputs) && inputs.length <= MAX_WORKFLOW_PORTS && inputs.every(validWorkflowPort)) && (outputs === void 0 || Array.isArray(outputs) && outputs.length <= MAX_WORKFLOW_PORTS && outputs.every(validWorkflowPort)) && (value.inputsTruncated === void 0 || typeof value.inputsTruncated === "boolean") && (value.outputsTruncated === void 0 || typeof value.outputsTruncated === "boolean") && (value.scientificFitStatus === void 0 || value.scientificFitStatus === "available" || value.scientificFitStatus === "unavailable");
		}
		function normalizeBootstrap(value) {
			if (!isRecord$2(value) || value.schemaVersion !== "1") throw new Error("Workflow Center bootstrap returned an incompatible payload");
			const packageInfo = value.package;
			const workflows = value.workflows;
			const diagnostics = value.diagnostics;
			const privacy = value.privacy;
			if (!isRecord$2(packageInfo) || !validString(packageInfo.name, 128) || !validString(packageInfo.version, 128) || !Array.isArray(workflows) || workflows.length > MAX_BOOTSTRAP_WORKFLOWS || !workflows.every(validWorkflow) || !Array.isArray(diagnostics) || diagnostics.length > 32 || !diagnostics.every((diagnostic) => isRecord$2(diagnostic) && (diagnostic.code === void 0 || validString(diagnostic.code, 128)) && (diagnostic.message === void 0 || validString(diagnostic.message, 1e3))) || !validBooleanRecord(value.capabilities) || !validBooleanRecord(value.readiness) || !isRecord$2(privacy) || privacy.ownerScopedDraftsViaAgent !== true || privacy.ownerScopedMissionsViaAgent !== true || privacy.ownerScopedDraftTestsViaAgent !== true || privacy.ownerScopedRunsViaAgent !== true) throw new Error("Workflow Center bootstrap returned an incompatible payload");
			return {
				...value,
				workflows: workflows.map((workflow) => ({
					...workflow,
					scientificFitStatus: workflow.scientificFitStatus ?? (workflow.inputs !== void 0 && workflow.outputs !== void 0 ? "available" : "unavailable")
				}))
			};
		}
		async function defaultLoadBootstrap(signal) {
			const response = await fetch("/api/bio-workflows/v1/bootstrap", {
				method: "GET",
				headers: { accept: "application/json" },
				cache: "no-store",
				signal
			});
			if (!response.ok) throw new Error(`Workflow Center bootstrap failed (${response.status})`);
			return response.json();
		}
		async function sendToAgent(sessions, text) {
			const sessionId = sessions.list.getSnapshot().current;
			if (!sessionId) throw new Error("Open a Harness task before asking the Agent.");
			const binding = sessions.binding(sessionId);
			if (!binding) throw new Error("The current Harness task is not available.");
			const result = await binding.session.prompt([{
				type: "text",
				text
			}], "queue");
			if (!result.ok) throw new Error(result.error ? `${result.error.code}: ${result.error.message}` : "The Agent did not accept the request.");
			sessions.open?.(sessionId);
			return sessionId;
		}
		function statusTone(value) {
			if ([
				"ready",
				"verified",
				"completed",
				"success"
			].includes(value.toLowerCase())) return "success";
			if ([
				"draft",
				"partial",
				"warning"
			].includes(value.toLowerCase())) return "warning";
			return "neutral";
		}
		function analysisEligible(workflow) {
			return workflow.executionSupported && workflow.scientificFitStatus === "available";
		}
		function analysisEligibilityLabel(workflow) {
			if (analysisEligible(workflow)) return "Execution eligible";
			if (workflow.executionSupported) return "Fit unavailable";
			return "Review only";
		}
		const PORT_TYPE_LABELS = {
			boolean: ["boolean", "booleans"],
			directory: ["directory", "directories"],
			file: ["file", "files"],
			integer: ["integer", "integers"],
			number: ["number", "numbers"],
			string: ["string", "strings"]
		};
		function portShape(port) {
			const labels = PORT_TYPE_LABELS[port.type] ?? [port.type, port.type];
			const type = port.cardinality === "many" ? `multiple ${labels[1]}` : labels[0];
			if (port.required === void 0) return type;
			return `${type} · ${port.required ? "required" : "optional"}`;
		}
		function compactPortSummary(ports, status) {
			if (status === "unavailable") return "Unavailable";
			if (ports === void 0 || ports.length === 0) return "Not declared";
			const first = ports[0];
			return `${first.id} · ${portShape(first)}${ports.length > 1 ? ` · +${ports.length - 1}` : ""}`;
		}
		function WorkflowPortList({ label, ports, status, truncated = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-port-list",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: label }),
					status === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Exact built-in manifest details are temporarily unavailable." }) : ports !== void 0 && ports.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", { children: ports.map((port) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: port.id }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: portShape(port) })] }), port.description ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: port.description }) : null] }, port.id)) }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Not declared in the workflow manifest." }),
					truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Additional declared items are omitted from this browser summary." }) : null
				]
			});
		}
		function Field({ label, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "dsh-bio-field",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), children]
			});
		}
		function AgentButton({ children, onClick, disabled = false, secondary = false }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: secondary ? "dsh-bio-button dsh-bio-button--secondary" : "dsh-bio-button",
				onClick,
				disabled,
				children: [children, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
			});
		}
		function AgentHandoffStatus({ handoff, onContinue }) {
			const queued = handoff.state === "queued";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-handoff",
				role: "status",
				"aria-live": "polite",
				"aria-atomic": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-bio-handoff__icon",
						"aria-hidden": "true",
						children: queued ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-bio-spinner" })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-handoff__body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-handoff__heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: handoff.action }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `dsh-bio-status dsh-bio-status--${queued ? "success" : "neutral"}`,
									children: queued ? "Queued" : "Sending"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: handoff.subject }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: queued ? `Request accepted; progress continues in the Agent task. ${handoff.detail}` : handoff.detail })
						]
					}),
					queued && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dsh-bio-handoff__action",
						onClick: onContinue,
						children: "Continue in Agent task"
					})
				]
			});
		}
		function WorkflowsArea({ workflows, selected, onSelect, ask, busy }) {
			const [query, setQuery] = (0, react.useState)("");
			const filtered = (0, react.useMemo)(() => {
				const needle = query.trim().toLowerCase();
				if (!needle) return workflows;
				return workflows.filter((workflow) => [
					workflow.id,
					workflow.name,
					workflow.summary,
					workflow.source,
					...workflow.tags,
					...(workflow.inputs ?? []).flatMap((port) => [
						port.id,
						port.type,
						port.description ?? ""
					]),
					...(workflow.outputs ?? []).flatMap((port) => [
						port.id,
						port.type,
						port.description ?? ""
					])
				].join(" ").toLowerCase().includes(needle));
			}, [query, workflows]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-area dsh-bio-area--workflows",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-bio-main-pane",
					"aria-labelledby": "dsh-bio-workflows-heading",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-area-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "dsh-bio-workflows-heading",
								children: "Analyze data"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Choose a workflow by the data it accepts and the results it produces." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-bio-count",
								children: [workflows.length, " releases"]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-search",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								type: "search",
								value: query,
								onChange: (event) => {
									setQuery(event.target.value);
								},
								placeholder: "Search workflow, input, output, or tag",
								"aria-label": "Search workflow catalog"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-workflow-table",
							role: "table",
							"aria-label": "Workflow catalog",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-workflow-table__head",
								role: "row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "Workflow"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "Inputs"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "Outputs"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "Execution"
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-workflow-table__body",
								children: [filtered.map((workflow) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									role: "row",
									"data-selected": selected?.digest === workflow.digest || void 0,
									onClick: () => {
										onSelect(workflow);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											role: "cell",
											className: "dsh-bio-workflow-name",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: workflow.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
												workflow.id,
												"@",
												workflow.version
											] })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "cell",
											className: "dsh-bio-port-summary",
											children: compactPortSummary(workflow.inputs, workflow.scientificFitStatus)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "cell",
											className: "dsh-bio-port-summary",
											children: compactPortSummary(workflow.outputs, workflow.scientificFitStatus)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "cell",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `dsh-bio-status dsh-bio-status--${analysisEligible(workflow) ? "success" : workflow.executionSupported ? "warning" : statusTone(workflow.status)}`,
												children: analysisEligibilityLabel(workflow)
											})
										})
									]
								}, `${workflow.id}@${workflow.version}:${workflow.source}`)), filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-empty",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "No matching workflows" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Try a data type such as FASTQ or BAM, or an analysis goal such as QC." })
									]
								})]
							})]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
					className: "dsh-bio-inspector",
					"aria-label": "Selected workflow details",
					children: selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-inspector__title",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: selected.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								selected.id,
								"@",
								selected.version
							] })] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-bio-summary",
							children: selected.summary
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: "dsh-bio-fit",
							"aria-labelledby": "dsh-bio-fit-heading",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									id: "dsh-bio-fit-heading",
									children: "Scientific fit"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-fit__ports",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowPortList, {
										label: "Accepted inputs",
										ports: selected.inputs,
										status: selected.scientificFitStatus,
										truncated: selected.inputsTruncated === true
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowPortList, {
										label: "Produced outputs",
										ports: selected.outputs,
										status: selected.scientificFitStatus,
										truncated: selected.outputsTruncated === true
									})]
								}),
								selected.scientificFitStatus === "unavailable" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "dsh-bio-fit__warning",
									children: "Scientific-fit metadata could not be verified. Package checking remains available, but analysis preparation is blocked."
								}) : null,
								selected.tags.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-bio-tags",
									"aria-label": "Catalog tags",
									children: selected.tags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tag }, tag))
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dsh-bio-disclosure dsh-bio-disclosure--technical",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Technical details" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: selected.verification.status })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
								className: "dsh-bio-facts",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Trust" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.trust })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Verification" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.verification.status })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Execution" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.executionSupported ? "Allowlisted" : "Validation only" })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Engine" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.engines.map((engine) => engine.name).join(", ") })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "WDL" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.languageVersion })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Digest" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
										title: selected.digest,
										children: [selected.digest.slice(0, 17), "…"]
									}) })] })
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bio-lane",
							"aria-label": "Safe workflow lifecycle",
							children: (analysisEligible(selected) ? [
								"Select",
								"Validate",
								"Plan",
								"Approve",
								"Run"
							] : [
								"Select",
								"Validate",
								"Graph",
								"Review"
							]).map((step, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								"data-active": index === 0 || void 0,
								children: step
							}, step))
						}),
						!selected.executionSupported && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-trust-note",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Not execution-allowlisted" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This bundle can be inspected and validated, but this package version will not plan or run it." })] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "dsh-bio-action-help",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Package check:" }),
								" ",
								PACKAGE_CHECK_DETAIL,
								" The allowlist is shown under Technical details; analysis eligibility also requires verified scientific-fit metadata, and Host readiness can still block planning or execution."
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-actions",
							children: [
								analysisEligible(selected) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
									disabled: busy,
									onClick: () => {
										ask(prompts.prepareWorkflow(selected), {
											action: "Analysis preparation",
											subject: `${selected.name} · ${selected.id}@${selected.version}`,
											detail: ANALYSIS_PREPARATION_DETAIL
										});
									},
									children: "Prepare analysis"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
									secondary: analysisEligible(selected),
									disabled: busy,
									onClick: () => {
										ask(prompts.validateWorkflow(selected), {
											action: "Workflow package check",
											subject: `${selected.name} · ${selected.id}@${selected.version}`,
											detail: PACKAGE_CHECK_DETAIL
										});
									},
									children: "Check workflow package"
								}),
								!analysisEligible(selected) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
									secondary: true,
									disabled: true,
									onClick: () => void 0,
									children: selected.executionSupported ? "Scientific fit unavailable" : "Analysis unavailable"
								})
							]
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-empty",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Select a workflow" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Details and safe next actions will appear here." })
						]
					})
				})]
			});
		}
		function DraftsArea({ ask, busy, draftWritesEnabled, isolatedTestConfigured }) {
			const [brief, setBrief] = (0, react.useState)(() => ({
				biologicalQuestion: "",
				inputData: "",
				desiredOutputs: "",
				constraints: "",
				acceptanceCriteria: ""
			}));
			const [draftId, setDraftId] = (0, react.useState)("");
			const [revision, setRevision] = (0, react.useState)("1");
			const [missionId, setMissionId] = (0, react.useState)("");
			const [fixtureId, setFixtureId] = (0, react.useState)("text-roundtrip");
			const [fixtureVersion, setFixtureVersion] = (0, react.useState)("1.0.0");
			const [testId, setTestId] = (0, react.useState)("");
			const validCreate = analysisBriefIsValid(brief);
			const briefSubject = brief.biologicalQuestion.trim().slice(0, 80);
			const validExisting = /^draft-[0-9a-f-]{36}$/.test(draftId) && Number.isSafeInteger(Number(revision)) && Number(revision) > 0;
			const validMission = /^mission-[0-9a-f-]{36}$/.test(missionId) && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(fixtureId) && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)/.test(fixtureVersion);
			const validTest = /^test-[0-9a-f-]{36}$/.test(testId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-bio-area dsh-bio-area--single",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-bio-workbench",
					"aria-labelledby": "dsh-bio-drafts-heading",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-area-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "dsh-bio-drafts-heading",
								children: "Build or repair a workflow"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Describe the analysis in your own terms. The Agent handles draft naming while deterministic tools keep every revision exact." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `dsh-bio-badge ${draftWritesEnabled ? "" : "dsh-bio-badge--warning"}`,
								children: draftWritesEnabled ? "Owner-scoped" : "Writes off"
							})]
						}),
						!draftWritesEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-trust-note dsh-bio-trust-note--blocker",
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Workflow drafting is unavailable" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Open Setup to inspect readiness, then enable draft writes in the Host configuration. The browser cannot change this setting." })] })]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
							className: "dsh-bio-brief",
							onSubmit: (event) => {
								event.preventDefault();
								if (validCreate && draftWritesEnabled) ask(prompts.createDraft(brief), {
									action: "Workflow draft",
									subject: briefSubject || "New workflow from analysis brief",
									detail: "The Agent will propose a workflow id and name, create owner-scoped revision 1, and keep the draft untrusted and non-executable."
								});
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-section-title",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Analysis brief" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Describe the goal and evidence of success; no draft identifiers are required." })] })]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-brief__grid",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Biological question",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												required: true,
												maxLength: ANALYSIS_BRIEF_LIMITS.biologicalQuestion,
												value: brief.biologicalQuestion,
												onChange: (event) => {
													setBrief((value) => ({
														...value,
														biologicalQuestion: event.target.value
													}));
												},
												placeholder: "What do you need to learn from these data?",
												rows: 3
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Input data and types",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												required: true,
												maxLength: ANALYSIS_BRIEF_LIMITS.inputData,
												value: brief.inputData,
												onChange: (event) => {
													setBrief((value) => ({
														...value,
														inputData: event.target.value
													}));
												},
												placeholder: "Describe the files, formats, pairing, and local paths you already have.",
												rows: 3
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Desired outputs",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												required: true,
												maxLength: ANALYSIS_BRIEF_LIMITS.desiredOutputs,
												value: brief.desiredOutputs,
												onChange: (event) => {
													setBrief((value) => ({
														...value,
														desiredOutputs: event.target.value
													}));
												},
												placeholder: "Name the reports, tables, or files you need.",
												rows: 3
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Constraints (optional)",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												maxLength: ANALYSIS_BRIEF_LIMITS.constraints,
												value: brief.constraints,
												onChange: (event) => {
													setBrief((value) => ({
														...value,
														constraints: event.target.value
													}));
												},
												placeholder: "Reference build, software, resource, privacy, or timing constraints.",
												rows: 3
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Acceptance criteria",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												required: true,
												maxLength: ANALYSIS_BRIEF_LIMITS.acceptanceCriteria,
												value: brief.acceptanceCriteria,
												onChange: (event) => {
													setBrief((value) => ({
														...value,
														acceptanceCriteria: event.target.value
													}));
												},
												placeholder: "What must be true for you to accept the workflow and its outputs?",
												rows: 3
											})
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-brief__footer",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The Agent proposes the internal id and name. You review every mutation in the Harness task." }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: "dsh-bio-button",
										type: "submit",
										disabled: !validCreate || busy || !draftWritesEnabled,
										title: draftWritesEnabled ? void 0 : "Enable draft writes in the Host configuration first.",
										children: ["Build workflow draft", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dsh-bio-disclosure dsh-bio-disclosure--advanced",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Advanced: exact draft and test identities" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "For existing lifecycle objects" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-disclosure__body",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-workbench__split",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
										onSubmit: (event) => {
											event.preventDefault();
											if (validExisting) ask(prompts.graphDraft(draftId, Number(revision)), {
												action: "Draft graph review",
												subject: `${draftId} · revision ${revision}`,
												detail: "The Agent will retrieve and explain the read-only graph for this exact revision. It will not change the draft."
											});
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-bio-section-title",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Inspect a revision" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Graph or validate one exact immutable revision." })] })]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Draft id",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													value: draftId,
													onChange: (event) => {
														setDraftId(event.target.value);
													},
													placeholder: "draft-…"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Exact revision",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													type: "number",
													min: "1",
													step: "1",
													value: revision,
													onChange: (event) => {
														setRevision(event.target.value);
													}
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-bio-actions dsh-bio-actions--inline",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
													className: "dsh-bio-button",
													type: "submit",
													disabled: !validExisting || busy,
													children: ["Show graph", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													className: "dsh-bio-button dsh-bio-button--secondary",
													type: "button",
													disabled: !validExisting || busy,
													onClick: () => {
														ask(prompts.validateDraft(draftId, Number(revision)), {
															action: "Draft validation",
															subject: `${draftId} · revision ${revision}`,
															detail: "The Agent will explain deterministic evidence for this exact revision. Any later repair remains compare-and-swap protected."
														});
													},
													children: "Validate revision"
												})]
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-bio-run-plan",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-bio-section-title",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Exact revision safety" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Source and immutable revision evidence remain authoritative." })] })]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Every update requires both the current revision and content digest. A conflict stops the write so you can reload and merge explicitly." })]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-workbench__split dsh-bio-workbench__split--runs",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
										onSubmit: (event) => {
											event.preventDefault();
											if (validMission && isolatedTestConfigured) ask(prompts.prepareDraftTest(missionId, fixtureId, fixtureVersion), {
												action: "Fixture test preparation",
												subject: `${missionId} · ${fixtureId}@${fixtureVersion}`,
												detail: "The Agent will prepare an exact isolated-test plan for review. It will not start the test, install, promote, allowlist, or production-run the draft."
											});
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-bio-section-title",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SetupIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Prepare an isolated fixture test" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "A new approval binds one ready Mission to exact fixture and runner identities." })] })]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Ready Mission id",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													value: missionId,
													onChange: (event) => {
														setMissionId(event.target.value);
													},
													placeholder: "mission-…"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Fixture id",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													value: fixtureId,
													onChange: (event) => {
														setFixtureId(event.target.value);
													}
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Fixture version",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													value: fixtureVersion,
													onChange: (event) => {
														setFixtureVersion(event.target.value);
													}
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												className: "dsh-bio-button",
												type: "submit",
												disabled: !validMission || busy || !isolatedTestConfigured,
												title: isolatedTestConfigured ? "Runs the exact Mission-specific preflight before producing an approval plan." : "Enable and configure the isolated fixture runner first.",
												children: ["Prepare with Agent", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
										onSubmit: (event) => {
											event.preventDefault();
											if (validTest) ask(prompts.inspectDraftTest(testId), {
												action: "Fixture evidence review",
												subject: testId,
												detail: "The Agent will retrieve bounded isolation, log, artifact, assertion, and failure evidence. It will not retry or promote anything."
											});
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-bio-section-title",
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Inspect isolated evidence" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Owner data stays behind the current Agent; bootstrap exposes readiness only." })] })]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
												label: "Test id",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
													value: testId,
													onChange: (event) => {
														setTestId(event.target.value);
													},
													placeholder: "test-…"
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												className: "dsh-bio-button dsh-bio-button--secondary",
												type: "submit",
												disabled: !validTest || busy,
												children: ["Inspect with Agent", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
											})
										]
									})]
								})]
							})]
						})
					]
				})
			});
		}
		function RunsArea({ selected, ask, busy }) {
			const [runId, setRunId] = (0, react.useState)("");
			const validRunId = /^run-[0-9a-f-]{36}$/.test(runId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-bio-area dsh-bio-area--single",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-bio-workbench",
					"aria-labelledby": "dsh-bio-runs-heading",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-area-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "dsh-bio-runs-heading",
								children: "Runs and results"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Review owner-scoped analyses as outcome-first cards in the Agent task; this panel never fetches run data through the browser bootstrap." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: "dsh-bio-button dsh-bio-button--secondary",
								type: "button",
								disabled: busy,
								onClick: () => {
									ask(prompts.listRuns(), {
										action: "Run history",
										subject: "Your owner-scoped workflow runs",
										detail: "The Agent will show recent outcomes and let you inspect one by position without copying an id. It will not start or retry a run."
									});
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {}), "Show recent runs"]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bio-run-strip",
							"aria-label": "Execution contract",
							children: [
								[
									"1",
									"Plan",
									"Inspect inputs and engine"
								],
								[
									"2",
									"Review",
									"Confirm digest-bound plan"
								],
								[
									"3",
									"Approve",
									"Harness asks explicitly"
								],
								[
									"4",
									"Run",
									"Track durable job state"
								]
							].map(([number, label, detail]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: number }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: detail })
							] }, number))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-workbench__split dsh-bio-workbench__split--runs",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
								className: "dsh-bio-disclosure dsh-bio-disclosure--panel",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Inspect a run by exact id" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Advanced" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
									onSubmit: (event) => {
										event.preventDefault();
										if (validRunId) ask(prompts.inspectRun(runId), {
											action: "Run inspection",
											subject: runId,
											detail: "The Agent will retrieve status, provenance, checksummed outputs, and normalized results. It will not start or retry a run."
										});
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-bio-section-title",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Exact run lookup" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Open an outcome-first result card with provenance and checksums on demand." })] })]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "Run id",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												value: runId,
												onChange: (event) => {
													setRunId(event.target.value);
												},
												placeholder: "run-…"
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											className: "dsh-bio-button",
											type: "submit",
											disabled: !validRunId || busy,
											children: ["Inspect with Agent", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
										})
									]
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-run-plan",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-section-title",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Prepare selected workflow" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Planning never starts a task." })] })]
								}), selected ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: selected.name }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
										selected.id,
										"@",
										selected.version
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", { children: [selected.digest.slice(0, 26), "…"] }),
									!selected.executionSupported && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This release keeps this bundle validation-only." }),
									selected.scientificFitStatus === "unavailable" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Scientific-fit metadata is unavailable, so preparation is blocked." }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
										disabled: busy || !analysisEligible(selected),
										onClick: () => {
											ask(prompts.prepareWorkflow(selected), {
												action: "Analysis preparation",
												subject: `${selected.name} · ${selected.id}@${selected.version}`,
												detail: ANALYSIS_PREPARATION_DETAIL
											});
										},
										children: analysisEligible(selected) ? "Prepare analysis" : selected.executionSupported ? "Scientific fit unavailable" : "Analysis unavailable"
									})
								] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-empty",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "No workflow selected" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Select one in Analyze data first." })
									]
								})]
							})]
						})
					]
				})
			});
		}
		const READINESS_COPY = {
			workflowCenter: ["Workflow Center", "Native browser surface is loaded."],
			workflowStore: ["Workflow store", "Built-ins are visible here; Agent tools can inspect configured local bundles."],
			localStoreConfigured: ["Local store", "Persistent install and draft root is configured."],
			storeWritesEnabled: ["Store writes", "Install and scaffold mutations are enabled."],
			draftAuthoringConfigured: ["Draft authoring", "Owner-scoped revision store is configured."],
			draftWritesEnabled: ["Draft writes", "Revisioned draft create and update mutations are enabled."],
			miniwdlValidator: ["miniwdl validator bridge", "DSH subprocess is available; validation still verifies the pinned executable."],
			autonomousMissionAuthoring: ["Autonomous authoring Missions", "One approval grants a bounded owner-session draft repair loop."],
			isolatedSoftwareTrialConfigured: [
				"Fixture runner configuration",
				"Dedicated storage, immutable fixtures, subprocess, and jobs are configured.",
				"Configured",
				"Off"
			],
			isolatedSoftwareTrialPreflightVerified: [
				"Exact trial preflight",
				"miniwdl, Docker, images, controller identity, cgroup v2, AppArmor, and denial controls are verified per Mission plan.",
				"Verified",
				"Unverified"
			],
			isolatedSoftwareTrial: [
				"Isolated software trials",
				"Ready is reported only for a fresh, exact Mission-specific preflight; prepare performs that check.",
				"Ready",
				"Not ready"
			],
			workflowGraph: ["WorkflowGraph v1", "Deterministic read-only WDL graph extraction is available."],
			executionConfigured: ["Execution adapter", "Input roots, runs root, and work directory are configured."],
			executionEnabled: ["Workflow execution", "Opt-in miniwdl execution is enabled."],
			jobsAvailable: ["DSH jobs", "Background run lifecycle can be tracked."]
		};
		const ANALYSIS_READINESS_BLOCKERS = [
			[
				"workflowStore",
				"Workflow catalog is unavailable.",
				"Reload the catalog or diagnose the configured workflow Store."
			],
			[
				"miniwdlValidator",
				"The miniwdl validation bridge is unavailable.",
				"Configure DSH subprocess access and the pinned miniwdl 1.15.0 executable."
			],
			[
				"executionConfigured",
				"The execution adapter is not configured.",
				"Configure the input roots, runs root, and work directory in the Host."
			],
			[
				"jobsAvailable",
				"DSH jobs are unavailable.",
				"Enable the Host jobs service before workflow execution can be tracked."
			],
			[
				"executionEnabled",
				"Workflow execution is disabled.",
				"Enable execution explicitly in Host configuration after reviewing its policy."
			]
		];
		function SetupArea({ bootstrap, ask, busy }) {
			const blocker = ANALYSIS_READINESS_BLOCKERS.find(([key]) => bootstrap.readiness[key] !== true);
			const ready = blocker === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-bio-area dsh-bio-area--single",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dsh-bio-workbench",
					"aria-labelledby": "dsh-bio-setup-heading",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-area-heading",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								id: "dsh-bio-setup-heading",
								children: "Environment readiness"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Read-only status from the loaded host plugin. Disabled features stay explicit." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dsh-bio-version",
								children: ["v", bootstrap.package.version]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: `dsh-bio-readiness-summary dsh-bio-readiness-summary--${ready ? "ready" : "blocked"}`,
							role: "status",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `dsh-bio-readiness__icon dsh-bio-readiness__icon--${ready ? "ready" : "off"}`,
									children: ready ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: ready ? "Ready for analysis" : "Analysis execution is blocked" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: ready ? "Catalog, validation, execution adapter, jobs, and execution opt-in are ready. Every run still requires a reviewed plan and approval." : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: blocker[1] }),
									" ",
									blocker[2]
								] }) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `dsh-bio-status dsh-bio-status--${ready ? "success" : "warning"}`,
									children: ready ? "Ready" : "Blocked"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-bio-readiness-context",
							children: "Draft authoring and isolated fixture testing have separate readiness and authorization boundaries; they do not make production analysis executable."
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
							className: "dsh-bio-disclosure dsh-bio-disclosure--setup",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Operator details" }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [Object.keys(READINESS_COPY).length, " checks"] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-bio-readiness",
								children: Object.entries(READINESS_COPY).map(([key, [label, description, onLabel = "Ready", offLabel = "Off"]]) => {
									const itemReady = bootstrap.readiness[key] === true;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `dsh-bio-readiness__icon dsh-bio-readiness__icon--${itemReady ? "ready" : "off"}`,
											children: itemReady ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: description })] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `dsh-bio-status dsh-bio-status--${itemReady ? "success" : "neutral"}`,
											children: itemReady ? onLabel : offLabel
										})
									] }, key);
								})
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-setup-footer",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Need a complete check?" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The Agent can inspect miniwdl, Docker, jobs, roots, and policy without changing them." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
								disabled: busy,
								onClick: () => {
									ask(prompts.diagnoseSetup(), {
										action: "Setup diagnosis",
										subject: "dsh-bio-workflows environment",
										detail: "The Agent will inspect workflow, validator, Docker, jobs, roots, and policy readiness. It will not change configuration."
									});
								},
								children: "Diagnose setup"
							})]
						})
					]
				})
			});
		}
		function WorkflowCenter({ sessions, open, onClose, loadBootstrap = defaultLoadBootstrap }) {
			const [area, setArea] = (0, react.useState)("workflows");
			const [bootstrap, setBootstrap] = (0, react.useState)(EMPTY_BOOTSTRAP);
			const [loading, setLoading] = (0, react.useState)(true);
			const [loadError, setLoadError] = (0, react.useState)(null);
			const [reloadKey, setReloadKey] = (0, react.useState)(0);
			const [selectedDigest, setSelectedDigest] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [handoff, setHandoff] = (0, react.useState)(null);
			const centerRef = (0, react.useRef)(null);
			const previousFocusRef = (0, react.useRef)(null);
			const handoffRequestRef = (0, react.useRef)(0);
			const dismissCenter = (0, react.useCallback)(() => {
				handoffRequestRef.current += 1;
				setHandoff(null);
				setNotice(null);
				onClose();
			}, [onClose]);
			const subscribeSessions = (0, react.useMemo)(() => (listener) => sessions.list.subscribe(listener), [sessions]);
			const currentSessionSnapshot = (0, react.useMemo)(() => () => sessions.list.getSnapshot().current, [sessions]);
			const currentSessionId = (0, react.useSyncExternalStore)(subscribeSessions, currentSessionSnapshot, currentSessionSnapshot);
			const agentAvailable = currentSessionId !== void 0 && sessions.binding(currentSessionId) !== void 0;
			const actionsDisabled = busy || !agentAvailable;
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setLoading(true);
				setLoadError(null);
				loadBootstrap(controller.signal).then((candidate) => {
					const value = normalizeBootstrap(candidate);
					setBootstrap(value);
					setSelectedDigest((current) => current !== null && value.workflows.some((workflow) => workflow.digest === current) ? current : value.workflows.find(analysisEligible)?.digest ?? value.workflows[0]?.digest ?? null);
					setLoading(false);
				}).catch((error) => {
					if (controller.signal.aborted) return;
					setLoadError(error instanceof Error ? error.message : String(error));
					setLoading(false);
				});
				return () => {
					controller.abort();
				};
			}, [loadBootstrap, reloadKey]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const center = centerRef.current;
				if (center === null) return;
				previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
				(center.querySelector("[data-initial-focus]") ?? center).focus();
				const handleDialogKeys = (event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						dismissCenter();
						return;
					}
					if (event.key !== "Tab") return;
					const focusable = focusableElements(center);
					if (focusable.length === 0) {
						event.preventDefault();
						center.focus();
						return;
					}
					const first = focusable[0];
					const last = focusable.at(-1);
					if (event.shiftKey && (document.activeElement === first || !center.contains(document.activeElement))) {
						event.preventDefault();
						last?.focus();
					} else if (!event.shiftKey && document.activeElement === last) {
						event.preventDefault();
						first.focus();
					}
				};
				document.addEventListener("keydown", handleDialogKeys);
				return () => {
					document.removeEventListener("keydown", handleDialogKeys);
					const previousFocus = previousFocusRef.current;
					previousFocusRef.current = null;
					if (previousFocus?.isConnected === true) previousFocus.focus();
				};
			}, [dismissCenter, open]);
			const selected = bootstrap.workflows.find((workflow) => workflow.digest === selectedDigest);
			const catalogDiagnostic = bootstrap.diagnostics[0];
			const catalogDiagnosticMessage = catalogDiagnostic?.message ?? catalogDiagnostic?.code ?? "A local workflow catalog entry could not be loaded.";
			const ask = (text, context) => {
				if (!agentAvailable) {
					setHandoff(null);
					setNotice({ message: "Open a Harness task before asking the Agent." });
					return;
				}
				setBusy(true);
				setNotice(null);
				setHandoff({
					...context,
					state: "sending"
				});
				const requestId = handoffRequestRef.current + 1;
				handoffRequestRef.current = requestId;
				sendToAgent(sessions, text).then(() => {
					if (handoffRequestRef.current !== requestId) return;
					setHandoff({
						...context,
						state: "queued"
					});
				}).catch((error) => {
					if (handoffRequestRef.current !== requestId) return;
					setHandoff(null);
					setNotice({ message: error instanceof Error ? error.message : String(error) });
				}).finally(() => {
					setBusy(false);
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				ref: centerRef,
				className: "dsh-bio-center",
				hidden: !open,
				tabIndex: -1,
				role: "dialog",
				"aria-modal": "true",
				"aria-labelledby": "dsh-bio-center-title",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "dsh-bio-center__header",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-center__identity",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							id: "dsh-bio-center-title",
							children: "Bio Workflows"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Biological intent to safe, reviewable analysis" })] })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-center__header-meta",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dsh-bio-badge ${agentAvailable ? "dsh-bio-badge--success" : "dsh-bio-badge--warning"}`,
							"aria-label": agentAvailable ? "Agent connected" : "Open a Harness task",
							"aria-live": "polite",
							"data-compact-label": agentAvailable ? "Agent ready" : "Open task",
							children: agentAvailable ? "Agent connected" : "Open a Harness task"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"data-initial-focus": true,
							type: "button",
							className: "dsh-bio-icon-button",
							"aria-label": "Close Workflow Center",
							title: "Close",
							onClick: dismissCenter,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bio-center__body",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "dsh-bio-nav",
						"aria-label": "Workflow Center jobs",
						children: [
							PRIMARY_AREAS.map(({ id, label, icon: Icon }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								"data-active": area === id || void 0,
								"aria-current": area === id ? "page" : void 0,
								onClick: () => {
									setArea(id);
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
							}, id)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dsh-bio-nav__utility",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									"data-active": area === "setup" || void 0,
									"aria-current": area === "setup" ? "page" : void 0,
									onClick: () => {
										setArea("setup");
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SetupIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Setup" })]
								})
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-nav__foot",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Safety boundary" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Harness Agent" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Tools remain authoritative" })
								]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
						className: "dsh-bio-content",
						children: [
							loadError && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-banner dsh-bio-banner--error",
								role: "alert",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: loadError }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => {
											setReloadKey((value) => value + 1);
										},
										children: "Retry"
									})
								]
							}),
							!loadError && catalogDiagnostic && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-banner dsh-bio-banner--error",
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [catalogDiagnosticMessage, bootstrap.diagnostics.length > 1 ? ` (+${bootstrap.diagnostics.length - 1} more)` : ""] })]
							}),
							notice && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-banner dsh-bio-banner--error",
								role: "alert",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice.message })]
							}),
							handoff && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentHandoffStatus, {
								handoff,
								onContinue: dismissCenter
							}),
							loading && area === "workflows" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-loading",
								"aria-live": "polite",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-bio-spinner" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Reading workflow catalog…" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The host is resolving verified bundles and readiness." })
								]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								area === "workflows" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowsArea, {
									workflows: bootstrap.workflows,
									selected,
									onSelect: (workflow) => {
										setSelectedDigest(workflow.digest);
									},
									ask,
									busy: actionsDisabled
								}),
								area === "drafts" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftsArea, {
									ask,
									busy: actionsDisabled,
									draftWritesEnabled: bootstrap.readiness.draftWritesEnabled === true,
									isolatedTestConfigured: bootstrap.readiness.isolatedSoftwareTrialConfigured === true
								}),
								area === "runs" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsArea, {
									selected,
									ask,
									busy: actionsDisabled
								}),
								area === "setup" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SetupArea, {
									bootstrap,
									ask,
									busy: actionsDisabled
								})
							] })
						]
					})]
				})]
			});
		}
		//#endregion
		//#region src/client/graph-layout.ts
		const NODE_WIDTH = 178;
		const NODE_HEIGHT = 76;
		const COLUMN_GAP = 76;
		const ROW_GAP = 30;
		const PADDING = 26;
		function layoutWorkflowGraph(graph) {
			const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
			const semanticEdges = graph.edges.filter((edge) => edge.kind !== "containment" && nodeById.has(edge.from.node) && nodeById.has(edge.to.node));
			const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
			const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
			for (const edge of semanticEdges) {
				incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
				outgoing.get(edge.from.node)?.push(edge.to.node);
			}
			const layer = /* @__PURE__ */ new Map();
			const queue = graph.nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).sort((left, right) => left.range.start.offset - right.range.start.offset);
			for (const node of queue) layer.set(node.id, node.kind === "workflow-input" ? 0 : 1);
			let head = 0;
			while (head < queue.length) {
				const node = queue[head];
				head += 1;
				for (const target of outgoing.get(node.id) ?? []) {
					layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(node.id) ?? 0) + 1));
					incoming.set(target, (incoming.get(target) ?? 1) - 1);
					if (incoming.get(target) === 0) queue.push(nodeById.get(target));
				}
			}
			let fallbackLayer = Math.max(0, ...layer.values());
			for (const node of graph.nodes) if (!layer.has(node.id)) {
				fallbackLayer += 1;
				layer.set(node.id, fallbackLayer);
			}
			const finalLayer = Math.max(0, ...layer.values());
			for (const node of graph.nodes) if (node.kind === "workflow-output") layer.set(node.id, Math.max(finalLayer, layer.get(node.id) ?? 0));
			const groups = /* @__PURE__ */ new Map();
			for (const node of graph.nodes) {
				const column = layer.get(node.id) ?? 0;
				groups.set(column, [...groups.get(column) ?? [], node]);
			}
			for (const values of groups.values()) values.sort((left, right) => left.range.start.offset - right.range.start.offset);
			const positioned = [];
			for (const [column, values] of [...groups.entries()].sort(([left], [right]) => left - right)) values.forEach((node, row) => {
				positioned.push({
					...node,
					x: PADDING + column * 254,
					y: PADDING + row * 106,
					width: NODE_WIDTH,
					height: NODE_HEIGHT
				});
			});
			const columnCount = Math.max(1, ...groups.keys()) + 1;
			const maxRows = Math.max(1, ...[...groups.values()].map((values) => values.length));
			return {
				nodes: positioned,
				edges: graph.edges,
				width: PADDING * 2 + columnCount * NODE_WIDTH + Math.max(0, columnCount - 1) * COLUMN_GAP,
				height: PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP
			};
		}
		function graphEdgePath(from, to) {
			const startX = from.x + from.width;
			const startY = from.y + from.height / 2;
			const endX = to.x;
			const endY = to.y + to.height / 2;
			const distance = Math.max(38, Math.abs(endX - startX) * .48);
			return `M ${startX} ${startY} C ${startX + distance} ${startY}, ${endX - distance} ${endY}, ${endX} ${endY}`;
		}
		//#endregion
		//#region src/client/WorkflowGraphView.tsx
		const DIGEST$1 = /^sha256:[a-f0-9]{64}$/;
		const DRAFT_ID = /^draft-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		const NODE_KINDS = /* @__PURE__ */ new Set([
			"workflow-input",
			"workflow-output",
			"declaration",
			"call",
			"scatter",
			"conditional"
		]);
		const EDGE_KINDS = /* @__PURE__ */ new Set([
			"data",
			"control",
			"containment"
		]);
		const MAX_GRAPH_RESULT_CHARACTERS = 4 * 1024 * 1024;
		const MAX_TOOL_CONTENT_BLOCKS$1 = 128;
		function isRecord$1(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function isBoundedString(value, maximum) {
			return typeof value === "string" && value.length > 0 && value.length <= maximum;
		}
		function isPosition(value) {
			return isRecord$1(value) && typeof value.line === "number" && Number.isSafeInteger(value.line) && value.line >= 1 && typeof value.column === "number" && Number.isSafeInteger(value.column) && value.column >= 1 && typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0;
		}
		function isRange(value) {
			return isRecord$1(value) && value.path === "main.wdl" && isPosition(value.start) && isPosition(value.end) && Number(value.end.offset) >= Number(value.start.offset);
		}
		function isPort(value) {
			return isRecord$1(value) && isBoundedString(value.id, 160) && isBoundedString(value.name, 160) && isBoundedString(value.type, 256);
		}
		function hasUniqueIds(values) {
			const ids = values.map((value) => isRecord$1(value) ? value.id : void 0);
			return ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
		}
		function isNode(value) {
			if (!isRecord$1(value) || !isBoundedString(value.id, 240) || typeof value.kind !== "string" || !NODE_KINDS.has(value.kind) || !isBoundedString(value.label, 240) || !isRange(value.range) || !Array.isArray(value.inputs) || value.inputs.length > 128 || !value.inputs.every(isPort) || !hasUniqueIds(value.inputs) || !Array.isArray(value.outputs) || value.outputs.length > 128 || !value.outputs.every(isPort) || !hasUniqueIds(value.outputs)) return false;
			if (value.target !== void 0 && !isBoundedString(value.target, 240)) return false;
			if (value.parentGroup !== void 0 && !isBoundedString(value.parentGroup, 240)) return false;
			return true;
		}
		function isEndpoint(value) {
			return isRecord$1(value) && isBoundedString(value.node, 240) && isBoundedString(value.port, 160);
		}
		function isEdge(value) {
			return isRecord$1(value) && isBoundedString(value.id, 96) && typeof value.kind === "string" && EDGE_KINDS.has(value.kind) && isEndpoint(value.from) && isEndpoint(value.to);
		}
		function isDiagnostic(value) {
			return isRecord$1(value) && isBoundedString(value.code, 96) && (value.severity === "warning" || value.severity === "error") && isBoundedString(value.message, 1e3) && (value.range === void 0 || isRange(value.range));
		}
		function isWorkflowGraph(value) {
			if (!isRecord$1(value) || value.schemaVersion !== "1" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 256 || typeof value.draftId !== "string" || !DRAFT_ID.test(value.draftId) || typeof value.contentDigest !== "string" || !DIGEST$1.test(value.contentDigest) || typeof value.graphDigest !== "string" || !DIGEST$1.test(value.graphDigest) || value.sourcePath !== "main.wdl" || !isBoundedString(value.languageVersion, 32) || typeof value.complete !== "boolean" || !isRecord$1(value.workflow) || !isBoundedString(value.workflow.name, 128) || !isRange(value.workflow.range) || !Array.isArray(value.nodes) || value.nodes.length > 512 || !value.nodes.every(isNode) || !hasUniqueIds(value.nodes) || !Array.isArray(value.edges) || value.edges.length > 2048 || !value.edges.every(isEdge) || !hasUniqueIds(value.edges) || !Array.isArray(value.diagnostics) || value.diagnostics.length > 128 || !value.diagnostics.every(isDiagnostic) || value.executionAuthorized !== false) return false;
			const nodes = value.nodes;
			const nodeById = new Map(nodes.map((node) => [node.id, node]));
			for (const node of nodes) if (node.parentGroup !== void 0) {
				const parent = nodeById.get(node.parentGroup);
				if (parent === void 0 || parent.kind !== "scatter" && parent.kind !== "conditional") return false;
			}
			for (const edge of value.edges) {
				const from = nodeById.get(edge.from.node);
				const to = nodeById.get(edge.to.node);
				if (from === void 0 || to === void 0) return false;
				if (edge.kind === "containment") {
					if (edge.from.port !== "group" || edge.to.port !== "member" || to.parentGroup !== from.id) return false;
				} else if (edge.kind === "control") {
					if (edge.from.port !== "complete" || edge.to.port !== "after") return false;
				} else if (!from.outputs.some((port) => port.id === edge.from.port) || !to.inputs.some((port) => port.id === edge.to.port)) return false;
			}
			return true;
		}
		function rawArguments(block) {
			const value = block.call?.argsRaw ?? block.argsRaw;
			if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
			if (typeof value !== "string" || value.length > 64 * 1024) return null;
			try {
				const parsed = JSON.parse(value);
				return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
			} catch {
				return null;
			}
		}
		function graphFromBlock(block) {
			if (!Array.isArray(block.content) || block.content.length > MAX_TOOL_CONTENT_BLOCKS$1) return { error: "The graph result exceeds the safe replay limit." };
			const parts = [];
			let characters = 0;
			for (const item of block.content) {
				if (item?.type !== "text" || typeof item.text !== "string") continue;
				characters += item.text.length;
				if (characters > MAX_GRAPH_RESULT_CHARACTERS) return { error: "The graph result exceeds the safe replay limit." };
				parts.push(item.text);
			}
			const text = parts.join("\n");
			if (!text) return { error: "Waiting for the graph result…" };
			try {
				const value = JSON.parse(text);
				if (!isWorkflowGraph(value)) return { error: (value !== null && typeof value === "object" && "error" in value ? value.error?.message : void 0) ?? "The tool returned an invalid WorkflowGraph v1 payload." };
				const args = rawArguments(block);
				if (args !== null && (typeof args.draftId === "string" && args.draftId !== value.draftId || typeof args.revision === "number" && args.revision !== value.revision)) return { error: "The graph result does not match the requested draft revision." };
				return { graph: value };
			} catch {
				return { error: "The graph result is not valid JSON." };
			}
		}
		function kindLabel(kind) {
			return kind.replace("workflow-", "").replace("-", " ").toUpperCase();
		}
		function WorkflowGraphView({ graph, compact = false }) {
			const graphId = (0, react.useId)().replace(/:/g, "");
			const layout = (0, react.useMemo)(() => layoutWorkflowGraph(graph), [graph]);
			const positioned = (0, react.useMemo)(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout]);
			const [selectedId, setSelectedId] = (0, react.useState)(null);
			const selected = selectedId === null ? void 0 : positioned.get(selectedId);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-bio-graph",
				"data-compact": compact || void 0,
				"aria-label": `${graph.workflow.name} workflow graph`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-bio-graph__bar",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: graph.workflow.name }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"WDL ",
							graph.languageVersion,
							" · revision ",
							graph.revision
						] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dsh-bio-badge dsh-bio-badge--${graph.complete ? "success" : "warning"}`,
							children: graph.complete ? "Complete" : "Partial"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-bio-graph__viewport",
						tabIndex: 0,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							viewBox: `0 0 ${layout.width} ${layout.height}`,
							role: "img",
							"aria-labelledby": `${graphId}-title ${graphId}-description`,
							preserveAspectRatio: "xMinYMin meet",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("title", {
									id: `${graphId}-title`,
									children: [graph.workflow.name, " WDL dependency graph"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("desc", {
									id: `${graphId}-description`,
									children: [
										graph.nodes.length,
										" nodes and ",
										graph.edges.length,
										" proven edges. ",
										graph.diagnostics.length,
										" diagnostics."
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
									id: `${graphId}-arrow`,
									viewBox: "0 0 8 8",
									refX: "7",
									refY: "4",
									markerWidth: "6",
									markerHeight: "6",
									orient: "auto-start-reverse",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: "M 0 0 L 8 4 L 0 8 z",
										className: "dsh-bio-graph__arrow"
									})
								}) }),
								layout.edges.filter((edge) => edge.kind !== "containment").map((edge) => {
									const from = positioned.get(edge.from.node);
									const to = positioned.get(edge.to.node);
									if (!from || !to) return null;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: graphEdgePath(from, to),
										className: "dsh-bio-graph__edge",
										"data-kind": edge.kind,
										markerEnd: `url(#${graphId}-arrow)`
									}, edge.id);
								}),
								layout.nodes.map((node) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
									className: "dsh-bio-graph__node",
									"data-kind": node.kind,
									"data-selected": selectedId === node.id || void 0,
									role: "button",
									tabIndex: 0,
									"aria-label": `${kindLabel(node.kind)} ${node.label}`,
									onClick: () => {
										setSelectedId(node.id);
									},
									onKeyDown: (event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											setSelectedId(node.id);
										}
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: node.x,
											y: node.y,
											width: node.width,
											height: node.height,
											rx: "7"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
											x: node.x + 14,
											y: node.y + 22,
											className: "dsh-bio-graph__kind",
											children: kindLabel(node.kind)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
											x: node.x + 14,
											y: node.y + 47,
											className: "dsh-bio-graph__label",
											children: node.label
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("text", {
											x: node.x + 14,
											y: node.y + 64,
											className: "dsh-bio-graph__ports",
											children: [
												node.inputs.length,
												" in · ",
												node.outputs.length,
												" out"
											]
										})
									]
								}, node.id))
							]
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: "dsh-bio-graph__footer",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							graph.nodes.length,
							" nodes · ",
							graph.edges.length,
							" edges"
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
							title: graph.contentDigest,
							children: [graph.contentDigest.slice(0, 18), "…"]
						})]
					}),
					selected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-graph__selection",
						"aria-live": "polite",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: kindLabel(selected.kind) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: selected.label })] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								selected.range.path,
								":",
								selected.range.start.line,
								":",
								selected.range.start.column
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: selected.target ? `Target ${selected.target}` : `${selected.inputs.length} inputs · ${selected.outputs.length} outputs` }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								onClick: () => {
									setSelectedId(null);
								},
								children: "Clear selection"
							})
						]
					}),
					graph.diagnostics.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
						className: "dsh-bio-graph__diagnostics",
						"aria-label": "Graph diagnostics",
						children: graph.diagnostics.map((diagnostic, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
							"data-severity": diagnostic.severity,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: diagnostic.code }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: diagnostic.message })]
						}, `${diagnostic.code}-${index}`))
					})
				]
			});
		}
		function DraftGraphToolView({ block }) {
			if (block.kind !== "tool-result") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-tool-state",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-bio-spinner" }), "Parsing WDL graph…"]
			});
			const result = graphFromBlock(block);
			if (!result.graph) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dsh-bio-tool-state dsh-bio-tool-state--error",
				children: result.error
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowGraphView, {
				graph: result.graph,
				compact: true
			});
		}
		//#endregion
		//#region src/client/run-result.ts
		const MAX_TOOL_CONTENT_BLOCKS = 128;
		const MAX_TOOL_RESULT_CHARACTERS = 4 * 1024 * 1024;
		const MAX_RUN_LIST_ITEMS = 50;
		const MAX_PRESENTED_RUNS = 20;
		const MAX_ARTIFACT_GROUPS = 1024;
		const MAX_ARTIFACT_ITEMS = 1024;
		const MAX_PRESENTED_ARTIFACT_GROUPS = 12;
		const MAX_PRESENTED_ARTIFACT_ITEMS = 3;
		const MAX_FASTQC_REPORTS = 1024;
		const MAX_PRESENTED_FASTQC_REPORTS = 12;
		const MAX_FASTQC_MODULES = 16384;
		const MAX_RESULT_ARTIFACT_BYTES = 16n * 1024n * 1024n * 1024n;
		const MAX_TOTAL_RESULT_ARTIFACT_BYTES = 64n * 1024n * 1024n * 1024n;
		const MAX_SAMTOOLS_COUNT = (1n << 64n) - 1n;
		const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
		const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
		const DIGEST = /^sha256:[a-f0-9]{64}$/;
		const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
		const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/;
		const DISPLAY_BASENAME = /^(?!\.{1,2}$)[^/\\]+$/;
		const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
		const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
		const RUN_STATUS_SET = /* @__PURE__ */ new Set([
			"prepared",
			"running",
			"stopping",
			"completed",
			"failed",
			"killed",
			"interrupted"
		]);
		const TERMINAL_RUN_STATUS_SET = /* @__PURE__ */ new Set([
			"completed",
			"failed",
			"killed",
			"interrupted"
		]);
		const FASTQC_STATUS_SET = /* @__PURE__ */ new Set([
			"pass",
			"warn",
			"fail"
		]);
		function isRecord(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function boundedString(value, maximum) {
			return typeof value === "string" && value.length > 0 && value.length <= maximum;
		}
		function boundedDisplayString(value, maximum) {
			return boundedString(value, maximum) && !UNSAFE_DISPLAY_CHARACTERS.test(value);
		}
		function isoDate(value) {
			if (!boundedString(value, 64) || !ISO_TIMESTAMP.test(value)) return false;
			const parsed = new Date(value);
			return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
		}
		function validLifecycleTimes(status, startedAt, finishedAt) {
			if (TERMINAL_RUN_STATUS_SET.has(status) !== (typeof finishedAt === "string")) return false;
			return typeof finishedAt !== "string" || Date.parse(finishedAt) >= Date.parse(startedAt);
		}
		function lifecycleStatus(value) {
			return typeof value === "string" && RUN_STATUS_SET.has(value);
		}
		function digest(value) {
			return typeof value === "string" && DIGEST.test(value);
		}
		function workflowIdentity(value) {
			if (!isRecord(value) || !boundedString(value.id, 160) || !IDENTIFIER.test(value.id) || !boundedString(value.version, 96) || !SEMVER.test(value.version) || !digest(value.bundleDigest)) return null;
			return {
				id: value.id,
				version: value.version,
				bundleDigest: value.bundleDigest
			};
		}
		function sameWorkflow(left, right) {
			return left.id === right.id && left.version === right.version && left.bundleDigest === right.bundleDigest;
		}
		function safeError(value) {
			if (value === null || value === void 0) return void 0;
			if (!isRecord(value) || !boundedString(value.code, 96) || !IDENTIFIER.test(value.code)) return void 0;
			return { code: value.code };
		}
		function toolPayload(block) {
			if (block.kind !== "tool-result") return { state: "loading" };
			if (!Array.isArray(block.content) || block.content.length > MAX_TOOL_CONTENT_BLOCKS) return {
				state: "error",
				message: "The result exceeds the safe replay limit."
			};
			const parts = [];
			let characters = 0;
			for (const item of block.content) {
				if (item?.type !== "text" || typeof item.text !== "string") continue;
				characters += item.text.length;
				if (characters > MAX_TOOL_RESULT_CHARACTERS) return {
					state: "error",
					message: "The result exceeds the safe replay limit."
				};
				parts.push(item.text);
			}
			const text = parts.join("\n");
			if (text.length === 0) return { state: "loading" };
			let value;
			try {
				value = JSON.parse(text);
			} catch {
				return {
					state: "error",
					message: "The Agent returned an unreadable workflow result."
				};
			}
			if (!isRecord(value)) return {
				state: "error",
				message: "The Agent returned an invalid workflow result."
			};
			if (block.isError === true || value.ok === false || value.error !== null && value.error !== void 0) {
				const error = safeError(value.error);
				return {
					state: "error",
					message: error === void 0 ? "The workflow result could not be retrieved. Ask the Agent to explain the failure." : `The workflow result could not be retrieved (${error.code}). Ask the Agent to explain the failure.`
				};
			}
			if (value.ok !== true) return {
				state: "error",
				message: "The Agent returned an invalid workflow result."
			};
			return {
				state: "ready",
				value
			};
		}
		function requestedRunId(block) {
			const raw = block.call?.argsRaw ?? block.argsRaw;
			let args = raw;
			if (typeof raw === "string") {
				if (raw.length > 64 * 1024) return false;
				try {
					args = JSON.parse(raw);
				} catch {
					return false;
				}
			}
			if (!isRecord(args) || args.runId === void 0) return null;
			return typeof args.runId === "string" && RUN_ID.test(args.runId) ? args.runId : false;
		}
		function byteCount(value, maximum) {
			if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value) || value.length > 20) return null;
			const parsed = BigInt(value);
			return parsed <= maximum ? parsed : null;
		}
		function fastqcCounts(value) {
			if (!isRecord(value)) return null;
			const counts = {
				pass: value.pass,
				warn: value.warn,
				fail: value.fail
			};
			if (!Object.values(counts).every((count) => Number.isSafeInteger(count) && Number(count) >= 0 && Number(count) <= MAX_FASTQC_MODULES)) return null;
			return counts;
		}
		function sameCounts(left, right) {
			return left.pass === right.pass && left.warn === right.warn && left.fail === right.fail;
		}
		function projectFastqcSummary(value, summaryArtifactReferences) {
			if (!isRecord(value) || value.schemaVersion !== "1" || !Number.isSafeInteger(value.reportCount) || Number(value.reportCount) < 1 || Number(value.reportCount) > MAX_FASTQC_REPORTS || !Array.isArray(value.reports) || value.reports.length !== value.reportCount) return null;
			const moduleCounts = fastqcCounts(value.moduleCounts);
			if (moduleCounts === null) return null;
			const aggregate = {
				pass: 0,
				warn: 0,
				fail: 0
			};
			const reportArtifactReferences = /* @__PURE__ */ new Set();
			let totalModules = 0;
			const reports = [];
			for (const report of value.reports) {
				if (!isRecord(report) || !isRecord(report.artifact) || report.artifact.outputId !== "summary_reports" || !Number.isSafeInteger(report.artifact.ordinal) || Number(report.artifact.ordinal) < 0 || Number(report.artifact.ordinal) > 1023 || !summaryArtifactReferences.has(`${report.artifact.outputId}:${report.artifact.ordinal}`) || reportArtifactReferences.has(`${report.artifact.outputId}:${report.artifact.ordinal}`) || !boundedDisplayString(report.sample, 512) || !DISPLAY_BASENAME.test(report.sample) || typeof report.overallStatus !== "string" || !FASTQC_STATUS_SET.has(report.overallStatus) || !Array.isArray(report.modules) || report.modules.length < 1 || report.modules.length > 512) return null;
				reportArtifactReferences.add(`${report.artifact.outputId}:${report.artifact.ordinal}`);
				const counts = fastqcCounts(report.counts);
				if (counts === null) return null;
				const observed = {
					pass: 0,
					warn: 0,
					fail: 0
				};
				const moduleNames = /* @__PURE__ */ new Set();
				for (const module of report.modules) {
					if (!isRecord(module) || !boundedDisplayString(module.name, 256) || moduleNames.has(module.name) || typeof module.status !== "string" || !FASTQC_STATUS_SET.has(module.status)) return null;
					moduleNames.add(module.name);
					observed[module.status] += 1;
					totalModules += 1;
					if (totalModules > MAX_FASTQC_MODULES) return null;
				}
				if (!sameCounts(counts, observed)) return null;
				const expectedOverall = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
				if (report.overallStatus !== expectedOverall) return null;
				aggregate.pass += counts.pass;
				aggregate.warn += counts.warn;
				aggregate.fail += counts.fail;
				if (reports.length < MAX_PRESENTED_FASTQC_REPORTS) reports.push({
					sample: report.sample,
					overallStatus: report.overallStatus,
					counts
				});
			}
			if (!sameCounts(moduleCounts, aggregate) || reportArtifactReferences.size !== summaryArtifactReferences.size || [...summaryArtifactReferences].some((reference) => !reportArtifactReferences.has(reference))) return null;
			return {
				reportCount: Number(value.reportCount),
				moduleCounts,
				reports,
				reportsOmitted: Number(value.reportCount) - reports.length
			};
		}
		function projectSamtoolsSummary(value, artifactReferences) {
			if (!isRecord(value) || value.schemaVersion !== "1" || !isRecord(value.flagstat) || !isRecord(value.idxstats) || !isRecord(value.statsArtifact)) return null;
			if ([
				[value.flagstat.artifact, "flagstat_report"],
				[value.idxstats.artifact, "idxstats_report"],
				[value.statsArtifact, "stats_report"]
			].some(([reference, outputId]) => !isRecord(reference) || reference.outputId !== outputId || reference.ordinal !== 0 || !artifactReferences.has(`${outputId}:0`))) return null;
			const total = byteCount(value.flagstat.totalReads, MAX_SAMTOOLS_COUNT);
			const mapped = byteCount(value.flagstat.mappedReads, MAX_SAMTOOLS_COUNT);
			const properlyPaired = byteCount(value.flagstat.properlyPairedReads, MAX_SAMTOOLS_COUNT);
			const duplicates = byteCount(value.flagstat.duplicateReads, MAX_SAMTOOLS_COUNT);
			const indexMapped = byteCount(value.idxstats.mappedReads, MAX_SAMTOOLS_COUNT);
			const indexUnmapped = byteCount(value.idxstats.unmappedReads, MAX_SAMTOOLS_COUNT);
			if (total === null || mapped === null || properlyPaired === null || duplicates === null || indexMapped === null || indexUnmapped === null || mapped > total || properlyPaired > total || duplicates > total || indexMapped + indexUnmapped !== total || !Number.isSafeInteger(value.idxstats.referenceCount) || Number(value.idxstats.referenceCount) < 0 || Number(value.idxstats.referenceCount) > 16383) return null;
			return {
				totalReads: total.toString(),
				mappedReads: mapped.toString(),
				properlyPairedReads: properlyPaired.toString(),
				duplicateReads: duplicates.toString(),
				referenceCount: Number(value.idxstats.referenceCount),
				indexMappedReads: indexMapped.toString(),
				indexUnmappedReads: indexUnmapped.toString()
			};
		}
		function projectNormalizedResult(value, workflow, planDigest) {
			if (!isRecord(value) || value.schemaVersion !== "1" || value.status !== "completed" || !isoDate(value.generatedAt) || !digest(value.planDigest) || value.planDigest !== planDigest || !Array.isArray(value.artifacts) || value.artifacts.length > MAX_ARTIFACT_GROUPS || !isRecord(value.summaries) || !Array.isArray(value.diagnostics) || value.diagnostics.length > 32) return null;
			const resultWorkflow = workflowIdentity(value.workflow);
			if (resultWorkflow === null || !sameWorkflow(resultWorkflow, workflow)) return null;
			let artifactCount = 0;
			let totalBytes = 0n;
			const artifactGroups = [];
			const outputIds = /* @__PURE__ */ new Set();
			const artifactReferences = /* @__PURE__ */ new Set();
			for (const group of value.artifacts) {
				if (!isRecord(group) || !boundedString(group.outputId, 160) || !IDENTIFIER.test(group.outputId) || outputIds.has(group.outputId) || group.type !== "file" || group.cardinality !== "one" && group.cardinality !== "many" || !Array.isArray(group.items) || group.items.length > MAX_ARTIFACT_ITEMS) return null;
				outputIds.add(group.outputId);
				let groupBytes = 0n;
				const ordinals = /* @__PURE__ */ new Set();
				const examples = [];
				for (const [itemIndex, item] of group.items.entries()) {
					if (!isRecord(item) || !Number.isSafeInteger(item.ordinal) || Number(item.ordinal) !== itemIndex || ordinals.has(Number(item.ordinal)) || !boundedDisplayString(item.relativePath, 4096) || !RELATIVE_PATH.test(item.relativePath) || !digest(item.sha256)) return null;
					const size = byteCount(item.sizeBytes, MAX_RESULT_ARTIFACT_BYTES);
					if (size === null) return null;
					ordinals.add(Number(item.ordinal));
					artifactReferences.add(`${group.outputId}:${item.ordinal}`);
					artifactCount += 1;
					if (artifactCount > MAX_ARTIFACT_ITEMS) return null;
					groupBytes += size;
					totalBytes += size;
					if (totalBytes > MAX_TOTAL_RESULT_ARTIFACT_BYTES) return null;
					if (examples.length < MAX_PRESENTED_ARTIFACT_ITEMS) examples.push({
						relativePath: item.relativePath,
						sizeBytes: size.toString(),
						sha256: item.sha256
					});
				}
				if (artifactGroups.length < MAX_PRESENTED_ARTIFACT_GROUPS) artifactGroups.push({
					outputId: group.outputId,
					itemCount: group.items.length,
					totalBytes: groupBytes.toString(),
					examples,
					examplesOmitted: group.items.length - examples.length
				});
			}
			if (Object.keys(value.summaries).some((key) => key !== "fastqc" && key !== "samtools")) return null;
			let fastqc;
			if (value.summaries.fastqc !== void 0) {
				if (workflow.id !== "fastq-qc" || workflow.version !== "1.2.0") return null;
				const projectedFastqc = projectFastqcSummary(value.summaries.fastqc, new Set([...artifactReferences].filter((reference) => reference.startsWith("summary_reports:"))));
				if (projectedFastqc === null) return null;
				fastqc = projectedFastqc;
			}
			let samtools;
			if (value.summaries.samtools !== void 0) {
				if (workflow.id !== "bam-qc" || workflow.version !== "1.1.0") return null;
				const projectedSamtools = projectSamtoolsSummary(value.summaries.samtools, artifactReferences);
				if (projectedSamtools === null) return null;
				samtools = projectedSamtools;
			}
			if (fastqc !== void 0 && samtools !== void 0) return null;
			const diagnostics = [];
			for (const diagnostic of value.diagnostics) {
				if (!isRecord(diagnostic) || !boundedString(diagnostic.code, 96) || !IDENTIFIER.test(diagnostic.code)) return null;
				if (diagnostics.length < 8) diagnostics.push({ code: diagnostic.code });
			}
			return {
				generatedAt: value.generatedAt,
				artifactCount,
				totalBytes: totalBytes.toString(),
				artifactGroups,
				artifactGroupsOmitted: value.artifacts.length - artifactGroups.length,
				...fastqc === void 0 ? {} : { fastqc },
				...samtools === void 0 ? {} : { samtools },
				diagnostics,
				diagnosticsOmitted: value.diagnostics.length - diagnostics.length
			};
		}
		function projectRunRecord(value) {
			if (!isRecord(value) || value.schemaVersion !== "1" || !boundedString(value.runId, 64) || !RUN_ID.test(value.runId) || !lifecycleStatus(value.status) || !isoDate(value.startedAt) || value.finishedAt !== null && value.finishedAt !== void 0 && !isoDate(value.finishedAt) || !validLifecycleTimes(value.status, value.startedAt, value.finishedAt) || !isRecord(value.plan) || !digest(value.planDigest) || value.jobId !== null && value.jobId !== void 0 && (!boundedString(value.jobId, 160) || !JOB_ID.test(value.jobId))) return null;
			const workflow = workflowIdentity(value.plan.workflow);
			if (workflow === null) return null;
			const error = safeError(value.error);
			if (value.error !== null && value.error !== void 0 && error === void 0) return null;
			const hasResult = value.result !== null && value.result !== void 0;
			if (value.status === "completed" && error !== void 0 || value.status !== "completed" && hasResult || !TERMINAL_RUN_STATUS_SET.has(value.status) && error !== void 0 || (value.status === "failed" || value.status === "interrupted") && error === void 0) return null;
			let resultState = "missing";
			let result;
			if (hasResult) {
				const projectedResult = projectNormalizedResult(value.result, workflow, value.planDigest);
				if (projectedResult !== null && typeof value.finishedAt === "string" && Date.parse(projectedResult.generatedAt) >= Date.parse(value.startedAt) && Date.parse(projectedResult.generatedAt) <= Date.parse(value.finishedAt)) result = projectedResult;
				resultState = result === void 0 ? "invalid" : "available";
			}
			return {
				runId: value.runId,
				...typeof value.jobId === "string" ? { jobId: value.jobId } : {},
				status: value.status,
				startedAt: value.startedAt,
				...typeof value.finishedAt === "string" ? { finishedAt: value.finishedAt } : {},
				workflow,
				planDigest: value.planDigest,
				resultState,
				...result === void 0 || result === null ? {} : { result },
				...error === void 0 ? {} : { error }
			};
		}
		function projectRunGetToolResult(block) {
			const payload = toolPayload(block);
			if (payload.state !== "ready") return payload;
			const requested = requestedRunId(block);
			if (requested === false) return {
				state: "error",
				message: "The requested run identity is invalid."
			};
			const run = projectRunRecord(payload.value.run);
			if (run === null || requested !== null && requested !== run.runId) return {
				state: "error",
				message: "The run result does not match a valid requested workflow run."
			};
			return {
				state: "ready",
				value: run
			};
		}
		function projectHistoryItem(value) {
			if (!isRecord(value) || !boundedString(value.runId, 64) || !RUN_ID.test(value.runId) || !lifecycleStatus(value.status) || !isoDate(value.startedAt) || value.finishedAt !== null && value.finishedAt !== void 0 && !isoDate(value.finishedAt) || !validLifecycleTimes(value.status, value.startedAt, value.finishedAt)) return null;
			const workflow = workflowIdentity(value.workflow);
			if (workflow === null) return null;
			return {
				runId: value.runId,
				status: value.status,
				startedAt: value.startedAt,
				...typeof value.finishedAt === "string" ? { finishedAt: value.finishedAt } : {},
				workflow
			};
		}
		function projectRunListToolResult(block) {
			const payload = toolPayload(block);
			if (payload.state !== "ready") return payload;
			if (!Array.isArray(payload.value.runs) || payload.value.runs.length > MAX_RUN_LIST_ITEMS || !Number.isSafeInteger(payload.value.count) || Number(payload.value.count) !== payload.value.runs.length || typeof payload.value.truncated !== "boolean" || !Array.isArray(payload.value.diagnostics) || payload.value.diagnostics.length > 32 || payload.value.nextCursor !== null && (typeof payload.value.nextCursor !== "string" || !RUN_ID.test(payload.value.nextCursor))) return {
				state: "error",
				message: "The Agent returned an invalid run history."
			};
			const projected = [];
			const seen = /* @__PURE__ */ new Set();
			let previousStartedAt = Number.POSITIVE_INFINITY;
			for (const candidate of payload.value.runs) {
				const run = projectHistoryItem(candidate);
				if (run === null || seen.has(run.runId)) return {
					state: "error",
					message: "The Agent returned an invalid run history."
				};
				const startedAt = Date.parse(run.startedAt);
				if (startedAt > previousStartedAt) return {
					state: "error",
					message: "The Agent returned an invalid run history."
				};
				previousStartedAt = startedAt;
				seen.add(run.runId);
				if (projected.length < MAX_PRESENTED_RUNS) projected.push(run);
			}
			return {
				state: "ready",
				value: {
					runs: projected,
					hiddenCount: payload.value.runs.length - projected.length,
					hasNextPage: payload.value.nextCursor !== null,
					incomplete: payload.value.truncated || payload.value.diagnostics.length > 0
				}
			};
		}
		//#endregion
		//#region src/client/RunResultView.tsx
		const STATUS_COPY = {
			prepared: {
				label: "Prepared",
				heading: "Analysis is prepared",
				tone: "neutral"
			},
			running: {
				label: "Running",
				heading: "Analysis is running",
				tone: "neutral"
			},
			stopping: {
				label: "Stopping",
				heading: "Cancellation is in progress",
				tone: "warning"
			},
			completed: {
				label: "Completed",
				heading: "Analysis completed",
				tone: "success"
			},
			failed: {
				label: "Failed",
				heading: "Analysis did not complete",
				tone: "error"
			},
			killed: {
				label: "Cancelled",
				heading: "Analysis was cancelled",
				tone: "warning"
			},
			interrupted: {
				label: "Interrupted",
				heading: "Analysis was interrupted",
				tone: "warning"
			}
		};
		const FAILURE_DETAIL_BY_CODE = {
			miniwdl_failed: "The workflow engine reported a failure. Inspect bounded job output in the Agent task before preparing another run.",
			network_cleanup_failed: "The isolation network could not be cleaned up safely, so no successful result is claimed.",
			output_collection_failed: "Declared outputs could not be collected into a verified result. No output files are presented here.",
			result_collection_failed: "Declared outputs did not satisfy the result contract. No output files are presented here.",
			run_interrupted: "Runtime continuity was lost and no automatic retry occurred. Review provenance before deciding what to do next.",
			run_storage_budget_exceeded: "The run exceeded its storage budget and was stopped. No successful result is claimed.",
			run_wall_time_budget_exceeded: "The run exceeded its wall-time budget and was stopped. No successful result is claimed.",
			runner_lifecycle_failed: "The isolated runner did not complete its lifecycle safely. No successful result is claimed."
		};
		const DATE_FORMAT = new Intl.DateTimeFormat(void 0, {
			dateStyle: "medium",
			timeStyle: "short"
		});
		function formatDate(value) {
			return DATE_FORMAT.format(new Date(value));
		}
		function formatBytes(value) {
			const bytes = Number(BigInt(value));
			if (bytes < 1024) return `${bytes} B`;
			const units = [
				"KB",
				"MB",
				"GB"
			];
			let scaled = bytes;
			let unit = -1;
			do {
				scaled /= 1024;
				unit += 1;
			} while (scaled >= 1024 && unit < units.length - 1);
			return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unit]}`;
		}
		function formatCount(value) {
			return BigInt(value).toLocaleString();
		}
		function shortDigest(value) {
			return `${value.slice(0, 19)}…`;
		}
		function outputLabel(value) {
			const known = {
				html_reports: "HTML reports",
				zip_reports: "ZIP reports",
				summary_reports: "Summary reports",
				flagstat_report: "Flagstat report",
				stats_report: "Stats report",
				idxstats_report: "Index statistics report"
			};
			if (known[value] !== void 0) return known[value];
			return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
		}
		function workflowLabel(run) {
			return `${run.workflow.id}@${run.workflow.version}`;
		}
		function ToolState({ error }) {
			if (error !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-tool-state dsh-bio-tool-state--error",
				role: "alert",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), error]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-bio-tool-state",
				"aria-live": "polite",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-bio-spinner" }), "Reading workflow result…"]
			});
		}
		function StatusBadge({ status }) {
			const copy = STATUS_COPY[status];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `dsh-bio-badge dsh-bio-badge--${copy.tone}`,
				children: copy.label
			});
		}
		function FastqcCountsView({ counts }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
				className: "dsh-bio-result__qc-counts",
				"aria-label": "FastQC module results",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-tone": "success",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Passed" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.pass })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-tone": "warning",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Warnings" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.warn })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						"data-tone": "error",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Failed" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: counts.fail })]
					})
				]
			});
		}
		function SamtoolsCountsView({ summary }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
				className: "dsh-bio-result__qc-counts",
				"aria-label": "samtools technical counts",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Total reads" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatCount(summary.totalReads) })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Mapped reads" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatCount(summary.mappedReads) })] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "References" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: summary.referenceCount.toLocaleString() })] })
				]
			});
		}
		function outcomeCopy(run) {
			const status = STATUS_COPY[run.status];
			const result = run.result;
			if (run.status !== "completed") {
				const fallback = {
					prepared: "The approved execution has not started yet. Progress remains in the Agent task.",
					running: "The approved workflow is still running. Progress and bounded job output remain in the Agent task.",
					stopping: "A cancellation request is settling. Partial outputs are not presented as results.",
					failed: "No successful analysis result is claimed. Inspect the bounded failure evidence before preparing another run.",
					killed: "The run stopped by request. Any partial files are not presented as completed outputs.",
					interrupted: "Runtime continuity was lost and no automatic retry occurred. Review provenance before deciding what to do next.",
					completed: ""
				}[run.status];
				const detail = run.error === void 0 ? fallback : FAILURE_DETAIL_BY_CODE[run.error.code] ?? fallback;
				return {
					...status,
					detail
				};
			}
			if (run.resultState === "invalid") return {
				...status,
				tone: "warning",
				detail: "The run reached completed state, but its normalized result could not be safely verified in this view."
			};
			if (run.resultState === "missing" || result === void 0) return {
				...status,
				tone: "warning",
				detail: "The run reached completed state, but this historical record has no BioWorkflowResult v1 summary."
			};
			const fastqc = result.fastqc;
			if (fastqc !== void 0) {
				const { pass, warn, fail } = fastqc.moduleCounts;
				const reports = `${fastqc.reportCount} ${fastqc.reportCount === 1 ? "sample" : "samples"}`;
				if (fail > 0) return {
					...status,
					tone: "warning",
					detail: `FastQC finished for ${reports}. ${fail} checks failed and ${warn} warned; review the technical QC findings before downstream analysis.`
				};
				if (warn > 0) return {
					...status,
					tone: "warning",
					detail: `FastQC finished for ${reports}. ${pass} checks passed and ${warn} warned; review the warnings before downstream analysis.`
				};
				return {
					...status,
					detail: `FastQC finished for ${reports}; all ${pass} published checks passed.`
				};
			}
			const samtools = result.samtools;
			if (samtools !== void 0) return {
				...status,
				detail: `samtools validated the BAM/BAI pair and published bounded technical counts for ${formatCount(samtools.totalReads)} reads. Review the checksummed reports before downstream analysis.`
			};
			return {
				...status,
				detail: `The approved workflow finished and produced ${result.artifactCount} checksummed ${result.artifactCount === 1 ? "file" : "files"}. No structured biological summary is published for this workflow.`
			};
		}
		function ResultIcon({ tone }) {
			if (tone === "success") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {});
			if (tone === "neutral") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {});
		}
		function RunTechnicalEvidence({ run }) {
			const result = run.result;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "dsh-bio-result__evidence",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Technical evidence" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Provenance and checksums" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bio-result__evidence-body",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "dsh-bio-result__facts",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Run" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: run.runId }) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Workflow" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: workflowLabel(run) })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Started" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatDate(run.startedAt) })] }),
								run.finishedAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Finished" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatDate(run.finishedAt) })] }) : null,
								result !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Result recorded" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: formatDate(result.generatedAt) })] }) : null,
								run.jobId !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "DSH job" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: run.jobId }) })] }) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Bundle" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									title: run.workflow.bundleDigest,
									children: shortDigest(run.workflow.bundleDigest)
								}) })] }),
								run.planDigest !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Approved plan" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									title: run.planDigest,
									children: shortDigest(run.planDigest)
								}) })] }) : null,
								run.error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Failure code" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: run.error.code }) })] }) : null
							]
						}),
						result !== void 0 && result.artifactGroups.some((group) => group.examples.length > 0) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-result__checksums",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", { children: "Checksummed files" }),
								result.artifactGroups.flatMap((group, groupIndex) => group.examples.map((item, itemIndex) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: item.relativePath }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: formatBytes(item.sizeBytes) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
									title: item.sha256,
									children: shortDigest(item.sha256)
								})] }, `${group.outputId}:${groupIndex}:${itemIndex}`))),
								result.artifactGroups.some((group) => group.examplesOmitted > 0) || result.artifactGroupsOmitted > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Additional files remain available through the owner-scoped Agent result." }) : null
							]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dsh-bio-result__privacy",
							children: "Absolute host paths, owner identity, commands, environment values, and raw logs are intentionally not repeated here. Ask the Agent to inspect bounded DSH job output when needed."
						})
					]
				})]
			});
		}
		function RunResult({ run }) {
			const resultId = (0, react.useId)().replace(/:/g, "");
			const outcome = outcomeCopy(run);
			const result = run.result;
			const fastqc = result?.fastqc;
			const samtools = result?.samtools;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-bio-result",
				"data-tone": outcome.tone,
				"aria-label": `${workflowLabel(run)} analysis result`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-bio-result__header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Workflow result" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: workflowLabel(run) })] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { status: run.status })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-result__outcome",
						role: "status",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-bio-result__outcome-icon",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ResultIcon, { tone: outcome.tone })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: outcome.heading }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: outcome.detail })] })]
					}),
					fastqc !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-bio-result__section",
						"aria-labelledby": `${resultId}-fastqc-heading`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-result__section-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									id: `${resultId}-fastqc-heading`,
									children: "Technical quality summary"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
									fastqc.reportCount,
									" normalized FastQC ",
									fastqc.reportCount === 1 ? "report" : "reports"
								] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									fastqc.reportCount,
									" ",
									fastqc.reportCount === 1 ? "sample" : "samples"
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FastqcCountsView, { counts: fastqc.moduleCounts }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsh-bio-result__samples",
								"aria-label": "FastQC sample outcomes",
								children: fastqc.reports.map((report, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: report.sample }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
									report.counts.pass,
									" passed · ",
									report.counts.warn,
									" warned · ",
									report.counts.fail,
									" failed"
								] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: `dsh-bio-status dsh-bio-status--${report.overallStatus === "pass" ? "success" : report.overallStatus === "fail" ? "error" : "warning"}`,
									children: report.overallStatus === "pass" ? "Pass" : report.overallStatus === "fail" ? "Fail" : "Warn"
								})] }, `${report.sample}:${index}`))
							}),
							fastqc.reportsOmitted > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsh-bio-result__bounded-note",
								children: [fastqc.reportsOmitted, " additional sample reports remain in the owner-scoped Agent result."]
							}) : null
						]
					}) : null,
					samtools !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-bio-result__section",
						"aria-labelledby": `${resultId}-samtools-heading`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-result__section-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									id: `${resultId}-samtools-heading`,
									children: "Technical alignment summary"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Normalized from bounded samtools flagstat and idxstats reports" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									samtools.referenceCount,
									" ",
									samtools.referenceCount === 1 ? "reference" : "references"
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SamtoolsCountsView, { summary: samtools }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsh-bio-result__bounded-note",
								children: [
									formatCount(samtools.properlyPairedReads),
									" properly paired · ",
									formatCount(samtools.duplicateReads),
									" duplicates · ",
									formatCount(samtools.indexUnmappedReads),
									" index-reported unmapped"
								]
							})
						]
					}) : null,
					result !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
						className: "dsh-bio-result__section",
						"aria-labelledby": `${resultId}-output-heading`,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-bio-result__section-heading",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
									id: `${resultId}-output-heading`,
									children: "Produced outputs"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Checksummed files collected from declared workflow outputs" })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									result.artifactCount,
									" files · ",
									formatBytes(result.totalBytes)
								] })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsh-bio-result__outputs",
								children: result.artifactGroups.map((group) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: outputLabel(group.outputId) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: group.outputId })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
									group.itemCount,
									" ",
									group.itemCount === 1 ? "file" : "files",
									" · ",
									formatBytes(group.totalBytes)
								] })] }, group.outputId))
							}),
							result.artifactGroupsOmitted > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: "dsh-bio-result__bounded-note",
								children: [result.artifactGroupsOmitted, " additional output groups remain in the owner-scoped Agent result."]
							}) : null,
							result.diagnostics.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								className: "dsh-bio-result__diagnostics",
								"aria-label": "Result diagnostics",
								children: result.diagnostics.map((diagnostic, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: diagnostic.code }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Detailed diagnostic text remains in the owner-scoped Agent result." })] }, `${diagnostic.code}:${index}`))
							}) : null
						]
					}) : null,
					run.status === "completed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-bio-result__interpretation",
						children: "Completion confirms execution and result collection, not biological significance. Interpret QC findings in the context of the study design."
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunTechnicalEvidence, { run })
				]
			});
		}
		function historyDescription(run) {
			return {
				prepared: "Prepared; execution has not started",
				running: "Execution is still in progress",
				stopping: "Cancellation is settling",
				completed: "Completed; inspect for outputs and QC findings",
				failed: "Failed; inspect evidence before another plan",
				killed: "Cancelled; no completed result claimed",
				interrupted: "Interrupted; no automatic retry occurred"
			}[run.status];
		}
		function RunHistory({ runs, hiddenCount, hasNextPage, incomplete }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "dsh-bio-result dsh-bio-result--history",
				"aria-label": "Recent workflow analyses",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-bio-result__header",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Recent analyses" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Newest owner-scoped workflow runs" })] })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "dsh-bio-badge",
							children: [runs.length, " shown"]
						})]
					}),
					runs.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-result__empty",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "No workflow runs yet" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Prepare an analysis first; starting it will still require a reviewed plan and explicit approval." })
						]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
						className: "dsh-bio-result__history",
						children: runs.map((run) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-bio-result__history-track" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: workflowLabel(run) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: historyDescription(run) }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("small", { children: [
									formatDate(run.startedAt),
									" · run …",
									run.runId.slice(-8)
								] })
							] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatusBadge, { status: run.status })
						] }, run.runId))
					}),
					hiddenCount > 0 || hasNextPage || incomplete ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "dsh-bio-result__bounded-note",
						children: [
							hiddenCount > 0 ? `${hiddenCount} additional runs are hidden in this compact view. ` : "",
							hasNextPage ? "Ask the Agent for the next owner-scoped page. " : "",
							incomplete ? "History diagnostics indicate that some records may be unavailable." : ""
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "dsh-bio-result__interpretation",
						children: "Ask the Agent to inspect a visible run when you need its outcome, outputs, or provenance. This list cannot start or retry an analysis."
					})
				]
			});
		}
		function RunResultToolView({ block }) {
			const projection = (0, react.useMemo)(() => projectRunGetToolResult(block), [block]);
			if (projection.state === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolState, {});
			if (projection.state === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolState, { error: projection.message });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunResult, { run: projection.value });
		}
		function RunListToolView({ block }) {
			const projection = (0, react.useMemo)(() => projectRunListToolResult(block), [block]);
			if (projection.state === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolState, {});
			if (projection.state === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ToolState, { error: projection.message });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunHistory, { ...projection.value });
		}
		//#endregion
		//#region src/client/styles.ts
		const STYLE = `
.dsh-bio-center,.dsh-bio-center *{box-sizing:border-box}
.dsh-bio-center[hidden]{display:none}
.dsh-bio-center{--bio-bg:var(--dsw-alias-bg-base,#111318);--bio-layer:var(--dsw-alias-bg-layer-1,#171a20);--bio-layer-2:var(--dsw-alias-bg-layer-2,#1d2027);--bio-layer-3:var(--dsw-alias-bg-layer-3,#242832);--bio-text:var(--dsw-alias-label-primary,#f2f3f5);--bio-muted:var(--dsw-alias-label-secondary,#aeb4bf);--bio-subtle:var(--dsw-alias-label-tertiary,#858d9b);--bio-border:var(--dsw-alias-border-l1,rgba(255,255,255,.11));--bio-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.18));--bio-primary:var(--dsw-alias-button-primary-fill,#5b5cf0);--bio-primary-hover:var(--dsw-alias-button-primary-hover,#6f70f5);--bio-primary-text:var(--dsw-alias-button-primary-foreground,#fff);--bio-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));--bio-success:var(--dsw-alias-status-success,#42bf79);--bio-warning:var(--dsw-alias-status-warning,#e5ad3d);--bio-error:var(--dsw-alias-status-error,#ef6a72);position:absolute;inset:12px;z-index:80;display:flex;flex-direction:column;min-width:0;overflow:hidden;isolation:isolate;color:var(--bio-text);background:#111318;background:Canvas;border:1px solid var(--bio-border-2);border-radius:14px;box-shadow:0 18px 52px rgba(0,0,0,.34);font-family:var(--dsw-font-family,Inter,ui-sans-serif,system-ui,sans-serif);font-size:14px;line-height:1.45;animation:dsh-bio-open 260ms cubic-bezier(.16,1,.3,1)}
.dsh-bio-center:before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--bio-bg);pointer-events:none}
.dsh-bio-center ::selection,.dsh-bio-graph ::selection,.dsh-bio-result ::selection{background:color-mix(in srgb,var(--bio-primary,#5b5cf0) 42%,transparent);color:var(--bio-text,#f2f3f5)}
.dsh-bio-center ::-webkit-scrollbar,.dsh-bio-graph ::-webkit-scrollbar,.dsh-bio-result ::-webkit-scrollbar{width:10px;height:10px}.dsh-bio-center ::-webkit-scrollbar-track,.dsh-bio-graph ::-webkit-scrollbar-track,.dsh-bio-result ::-webkit-scrollbar-track{background:transparent}.dsh-bio-center ::-webkit-scrollbar-thumb,.dsh-bio-graph ::-webkit-scrollbar-thumb,.dsh-bio-result ::-webkit-scrollbar-thumb{background:var(--bio-border-2,rgba(255,255,255,.18));border:3px solid transparent;border-radius:8px;background-clip:padding-box}
@keyframes dsh-bio-open{from{transform:translateY(8px);clip-path:inset(0 0 3% 0);opacity:.96}to{transform:translateY(0);clip-path:inset(0);opacity:1}}
.dsh-bio-center button,.dsh-bio-center input,.dsh-bio-center textarea{font:inherit}.dsh-bio-center button{color:inherit}.dsh-bio-center button:focus-visible,.dsh-bio-center input:focus-visible,.dsh-bio-center textarea:focus-visible,.dsh-bio-graph [tabindex]:focus-visible,.dsh-bio-result summary:focus-visible{outline:2px solid color-mix(in srgb,var(--bio-primary,#5b5cf0) 78%,white);outline-offset:2px}
.dsh-bio-center__header{height:62px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 18px 0 20px;border-bottom:1px solid var(--bio-border);background:var(--bio-layer)}
.dsh-bio-center__identity,.dsh-bio-center__header-meta,.dsh-bio-inspector__title,.dsh-bio-section-title{display:flex;align-items:center}.dsh-bio-center__identity{gap:12px}.dsh-bio-center__identity>svg{width:22px;height:22px;color:color-mix(in srgb,var(--bio-primary) 78%,white)}.dsh-bio-center h1,.dsh-bio-center h2,.dsh-bio-center h3,.dsh-bio-center p{margin:0}.dsh-bio-center h1{font-size:15px;font-weight:680;letter-spacing:-.01em}.dsh-bio-center__identity p{font-size:12px;color:var(--bio-subtle);margin-top:1px}.dsh-bio-center__header-meta{gap:10px}
.dsh-bio-icon-button{width:36px;height:36px;display:grid;place-items:center;border:1px solid transparent;border-radius:8px;background:transparent;cursor:pointer}.dsh-bio-icon-button:hover{background:var(--bio-hover);border-color:var(--bio-border)}
.dsh-bio-center__body{flex:1;min-height:0;display:grid;grid-template-columns:168px minmax(0,1fr)}
.dsh-bio-nav{min-width:0;padding:14px 10px;display:flex;flex-direction:column;gap:4px;background:var(--bio-layer);border-right:1px solid var(--bio-border)}.dsh-bio-nav>button,.dsh-bio-nav__utility>button{height:40px;display:flex;align-items:center;gap:10px;padding:0 11px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--bio-muted);cursor:pointer;text-align:left}.dsh-bio-nav>button:hover,.dsh-bio-nav__utility>button:hover{background:var(--bio-hover);color:var(--bio-text)}.dsh-bio-nav>button[data-active],.dsh-bio-nav__utility>button[data-active]{background:color-mix(in srgb,var(--bio-primary) 15%,var(--bio-layer));border-color:color-mix(in srgb,var(--bio-primary) 28%,var(--bio-border));color:var(--bio-text)}.dsh-bio-nav>button[data-active] svg,.dsh-bio-nav__utility>button[data-active] svg{color:color-mix(in srgb,var(--bio-primary) 72%,white)}.dsh-bio-nav__utility{margin-top:auto;padding-top:8px;border-top:1px solid var(--bio-border)}.dsh-bio-nav__utility>button{width:100%}.dsh-bio-nav__foot{margin-top:8px;padding:14px 10px 6px;border-top:1px solid var(--bio-border);display:flex;flex-direction:column}.dsh-bio-nav__foot span,.dsh-bio-nav__foot small{font-size:11px;color:var(--bio-subtle)}.dsh-bio-nav__foot strong{font-size:12px;margin:3px 0}
.dsh-bio-content{min-width:0;min-height:0;position:relative;overflow:auto;background:var(--bio-bg)}.dsh-bio-area{min-height:100%;display:grid}.dsh-bio-area--workflows{grid-template-columns:minmax(520px,1fr) 300px}.dsh-bio-area--single{padding:24px;display:block}.dsh-bio-main-pane,.dsh-bio-workbench{min-width:0;padding:24px}.dsh-bio-main-pane{border-right:1px solid var(--bio-border)}
.dsh-bio-area-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.dsh-bio-area-heading h2{font-size:21px;font-weight:680;letter-spacing:-.025em}.dsh-bio-area-heading p{max-width:68ch;margin-top:5px;color:var(--bio-muted);font-size:13px}.dsh-bio-count,.dsh-bio-version{font-variant-numeric:tabular-nums;color:var(--bio-subtle);font-size:12px;padding-top:5px}
.dsh-bio-search{height:40px;display:flex;align-items:center;gap:9px;padding:0 12px;margin-bottom:12px;border:1px solid var(--bio-border);border-radius:8px;background:var(--bio-layer)}.dsh-bio-search:focus-within{border-color:color-mix(in srgb,var(--bio-primary) 70%,var(--bio-border))}.dsh-bio-search svg{width:16px;color:var(--bio-subtle)}.dsh-bio-search input{width:100%;height:100%;border:0;outline:0;color:var(--bio-text);background:transparent}.dsh-bio-search input::placeholder,.dsh-bio-field input::placeholder,.dsh-bio-field textarea::placeholder{color:var(--bio-subtle);opacity:1}
.dsh-bio-workflow-table{border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-workflow-table__head,.dsh-bio-workflow-table__body>button{display:grid;grid-template-columns:minmax(210px,1fr) minmax(132px,170px) minmax(132px,170px) 120px;align-items:center;gap:12px}.dsh-bio-workflow-table__head{height:34px;padding:0 12px;color:var(--bio-subtle);font-size:11px;text-transform:uppercase;letter-spacing:.055em}.dsh-bio-workflow-table__body>button{width:100%;min-height:58px;padding:9px 12px;border:0;border-top:1px solid var(--bio-border);background:transparent;text-align:left;cursor:pointer}.dsh-bio-workflow-table__body>button:hover{background:var(--bio-hover)}.dsh-bio-workflow-table__body>button[data-selected]{background:color-mix(in srgb,var(--bio-primary) 11%,var(--bio-layer));box-shadow:inset 2px 0 0 var(--bio-primary)}.dsh-bio-workflow-name{display:flex;min-width:0;flex-direction:column}.dsh-bio-workflow-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:610}.dsh-bio-workflow-name small{margin-top:2px;color:var(--bio-subtle);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}.dsh-bio-port-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bio-muted);font-size:11px}.dsh-bio-status,.dsh-bio-badge{display:inline-flex;align-items:center;justify-content:center;width:max-content;border:1px solid var(--bio-border);border-radius:999px;line-height:22px;padding:0 8px;font-size:11px;white-space:nowrap}.dsh-bio-status--success,.dsh-bio-badge--success{color:color-mix(in srgb,var(--bio-success) 78%,var(--bio-text));border-color:color-mix(in srgb,var(--bio-success) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-success) 9%,transparent)}.dsh-bio-status--warning,.dsh-bio-badge--warning{color:color-mix(in srgb,var(--bio-warning) 78%,var(--bio-text));border-color:color-mix(in srgb,var(--bio-warning) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-warning) 9%,transparent)}.dsh-bio-status--neutral{color:var(--bio-muted)}
.dsh-bio-inspector{min-width:0;padding:24px 20px;background:var(--bio-layer)}.dsh-bio-inspector__title{gap:10px}.dsh-bio-inspector__title>svg,.dsh-bio-section-title>svg{flex:none;color:color-mix(in srgb,var(--bio-primary) 68%,white)}.dsh-bio-inspector__title h3{font-size:16px}.dsh-bio-inspector__title p{font-size:11px;color:var(--bio-subtle);font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dsh-bio-summary{margin:18px 0 20px!important;color:var(--bio-muted);line-height:1.6}.dsh-bio-facts{margin:0;border-top:1px solid var(--bio-border)}.dsh-bio-facts>div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--bio-border)}.dsh-bio-facts dt{color:var(--bio-subtle)}.dsh-bio-facts dd{margin:0;text-align:right;color:var(--bio-muted)}.dsh-bio-facts code,.dsh-bio-run-plan code,.dsh-bio-graph code{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}.dsh-bio-tags{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.dsh-bio-tags span{padding:3px 7px;border:1px solid var(--bio-border);border-radius:5px;color:var(--bio-muted);font-size:11px}.dsh-bio-lane{position:relative;display:flex;justify-content:space-between;gap:4px;margin:24px 0 20px;padding-top:16px;border-top:1px solid var(--bio-border)}.dsh-bio-lane span{position:relative;color:var(--bio-subtle);font-size:10px}.dsh-bio-lane span:before{content:"";position:absolute;top:-20px;left:50%;width:7px;height:7px;border-radius:50%;background:var(--bio-layer-3);border:1px solid var(--bio-border-2);transform:translateX(-50%)}.dsh-bio-lane span[data-active]:before{background:var(--bio-primary);border-color:var(--bio-primary)}
.dsh-bio-fit{padding:16px 0 4px;border-top:1px solid var(--bio-border)}.dsh-bio-fit>h4{margin:0 0 8px;font-size:13px;font-weight:640}.dsh-bio-fit__ports{display:grid;gap:0}.dsh-bio-fit__warning{margin:4px 0 12px!important;color:color-mix(in srgb,var(--bio-warning) 58%,var(--bio-muted));font-size:11px;line-height:1.5}.dsh-bio-port-list{padding:10px 0;border-top:1px solid var(--bio-border)}.dsh-bio-port-list:first-child{border-top:0}.dsh-bio-port-list h4{margin:0 0 7px;color:var(--bio-subtle);font-size:11px;font-weight:620}.dsh-bio-port-list ul{list-style:none;margin:0;padding:0}.dsh-bio-port-list li+li{margin-top:10px}.dsh-bio-port-list li>div{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.dsh-bio-port-list li strong{font-size:12px}.dsh-bio-port-list li span,.dsh-bio-port-list p{color:var(--bio-subtle);font-size:11px}.dsh-bio-port-list li span{text-align:right}.dsh-bio-port-list li p{margin-top:3px!important;line-height:1.45}.dsh-bio-disclosure{border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-disclosure>summary{min-height:44px;display:flex;align-items:center;gap:10px;list-style:none;color:var(--bio-muted);cursor:pointer}.dsh-bio-disclosure>summary::-webkit-details-marker{display:none}.dsh-bio-disclosure>summary>span{font-weight:620}.dsh-bio-disclosure>summary>small{margin-left:auto;color:var(--bio-subtle);font-size:11px}.dsh-bio-disclosure>summary:after{content:"";width:7px;height:7px;flex:none;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(45deg) translateY(-2px);transform-origin:center;transition:transform 180ms ease}.dsh-bio-disclosure[open]>summary:after{transform:rotate(225deg) translate(-1px,-1px)}.dsh-bio-disclosure--technical{margin:8px 0 18px}.dsh-bio-disclosure--technical .dsh-bio-facts{border-top:1px solid var(--bio-border)}
.dsh-bio-action-help{margin:18px 0 12px!important;color:var(--bio-muted);font-size:12px;line-height:1.55}.dsh-bio-action-help strong{color:var(--bio-text);font-weight:620}.dsh-bio-actions{display:flex;flex-direction:column;gap:8px}.dsh-bio-actions--inline{flex-direction:row;flex-wrap:wrap}.dsh-bio-button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:7px 12px;border:1px solid var(--bio-primary);border-radius:8px;background:var(--bio-primary);color:var(--bio-primary-text)!important;font-weight:620;cursor:pointer}.dsh-bio-button:hover:not(:disabled){background:var(--bio-primary-hover)}.dsh-bio-button:disabled{cursor:not-allowed;opacity:.46}.dsh-bio-button svg{width:15px;height:15px}.dsh-bio-button--secondary{border-color:var(--bio-border-2);background:transparent;color:var(--bio-text)!important}.dsh-bio-button--secondary:hover:not(:disabled){background:var(--bio-hover)}
.dsh-bio-workbench{max-width:1120px;margin:0 auto}.dsh-bio-workbench__split{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-workbench__split>form,.dsh-bio-run-plan,.dsh-bio-disclosure--panel>form{padding:22px 22px 24px}.dsh-bio-workbench__split>form+form,.dsh-bio-run-plan{border-left:1px solid var(--bio-border)}.dsh-bio-section-title{gap:10px;margin-bottom:20px}.dsh-bio-section-title h3{font-size:15px}.dsh-bio-section-title p{margin-top:3px;color:var(--bio-subtle);font-size:12px}.dsh-bio-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.dsh-bio-field>span{color:var(--bio-muted);font-size:12px;font-weight:590}.dsh-bio-field input,.dsh-bio-field textarea{width:100%;border:1px solid var(--bio-border);border-radius:7px;background:var(--bio-layer);color:var(--bio-text);padding:9px 10px;outline:0}.dsh-bio-field input{height:40px}.dsh-bio-field textarea{resize:vertical;min-height:94px}.dsh-bio-field input:focus,.dsh-bio-field textarea:focus{border-color:color-mix(in srgb,var(--bio-primary) 70%,var(--bio-border))}.dsh-bio-brief{padding:22px;border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-brief__grid{display:grid;grid-template-columns:1fr 1fr;column-gap:18px}.dsh-bio-brief__grid>.dsh-bio-field:first-child{grid-column:1/-1}.dsh-bio-brief__footer{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:4px}.dsh-bio-brief__footer p{max-width:62ch;color:var(--bio-subtle);font-size:12px}.dsh-bio-brief__footer .dsh-bio-button{flex:none}.dsh-bio-disclosure--advanced{margin-top:22px}.dsh-bio-disclosure--advanced>summary{padding:0 4px}.dsh-bio-disclosure__body{border-top:1px solid var(--bio-border)}.dsh-bio-disclosure--panel{align-self:start;border:0}.dsh-bio-disclosure--panel>summary{padding:0 22px;border-bottom:1px solid var(--bio-border)}.dsh-bio-trust-note{display:flex;gap:12px;margin-top:18px;padding:14px;border:1px solid color-mix(in srgb,var(--bio-warning) 26%,var(--bio-border));border-radius:8px;background:color-mix(in srgb,var(--bio-warning) 7%,var(--bio-layer))}.dsh-bio-trust-note--blocker{margin:0 0 18px}.dsh-bio-trust-note>svg{flex:none;color:var(--bio-warning)}.dsh-bio-trust-note p{margin-top:3px;color:color-mix(in srgb,var(--bio-warning) 45%,var(--bio-muted));font-size:12px}
.dsh-bio-run-strip{display:grid;grid-template-columns:repeat(4,1fr);margin:10px 0 22px;border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-run-strip>div{position:relative;display:grid;grid-template-columns:24px 1fr;column-gap:9px;padding:15px}.dsh-bio-run-strip>div+div{border-left:1px solid var(--bio-border)}.dsh-bio-run-strip span{grid-row:1/3;width:22px;height:22px;display:grid;place-items:center;border:1px solid var(--bio-border-2);border-radius:50%;font-size:10px;font-variant-numeric:tabular-nums}.dsh-bio-run-strip strong{font-size:12px}.dsh-bio-run-strip small{color:var(--bio-subtle);font-size:10px}.dsh-bio-run-plan{display:flex;flex-direction:column;align-items:flex-start}.dsh-bio-run-plan>p{margin:4px 0;color:var(--bio-muted)}.dsh-bio-run-plan>code{margin:10px 0 20px;color:var(--bio-subtle)}.dsh-bio-run-plan>.dsh-bio-button{margin-top:auto}
.dsh-bio-readiness-summary{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:12px;padding:16px;border:1px solid var(--bio-border);border-radius:9px;background:var(--bio-layer)}.dsh-bio-readiness-summary--blocked{border-color:color-mix(in srgb,var(--bio-warning) 30%,var(--bio-border));background:color-mix(in srgb,var(--bio-warning) 7%,var(--bio-layer))}.dsh-bio-readiness-summary p{margin-top:3px;color:var(--bio-muted);font-size:12px}.dsh-bio-readiness-summary b{color:var(--bio-text);font-weight:620}.dsh-bio-readiness-context{margin:10px 4px 18px!important;color:var(--bio-subtle);font-size:12px}.dsh-bio-disclosure--setup>summary{padding:0 4px}.dsh-bio-readiness{border-top:1px solid var(--bio-border)}.dsh-bio-readiness>div{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:64px;padding:9px 4px;border-bottom:1px solid var(--bio-border)}.dsh-bio-readiness__icon{width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--bio-border);border-radius:7px}.dsh-bio-readiness__icon svg{width:15px}.dsh-bio-readiness__icon--ready{color:var(--bio-success);background:color-mix(in srgb,var(--bio-success) 8%,transparent)}.dsh-bio-readiness__icon--off{color:var(--bio-subtle)}.dsh-bio-readiness p{margin-top:2px;color:var(--bio-subtle);font-size:12px}.dsh-bio-setup-footer{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 4px}.dsh-bio-setup-footer p{margin-top:3px;color:var(--bio-muted)}
.dsh-bio-banner{display:flex;align-items:center;gap:9px;margin:14px 18px 0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--bio-success) 28%,var(--bio-border));border-radius:8px;background:color-mix(in srgb,var(--bio-success) 7%,var(--bio-layer));color:color-mix(in srgb,var(--bio-success) 42%,var(--bio-text));font-size:12px}.dsh-bio-banner svg{width:16px}.dsh-bio-banner--error{border-color:color-mix(in srgb,var(--bio-error) 30%,var(--bio-border));background:color-mix(in srgb,var(--bio-error) 7%,var(--bio-layer));color:color-mix(in srgb,var(--bio-error) 38%,var(--bio-text))}.dsh-bio-banner button{margin-left:auto;border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.dsh-bio-handoff{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:12px;margin:14px 18px 0;padding:12px 14px;border:1px solid color-mix(in srgb,var(--bio-success) 28%,var(--bio-border));border-radius:8px;background:color-mix(in srgb,var(--bio-success) 7%,var(--bio-layer));color:var(--bio-text)}.dsh-bio-handoff__icon{width:28px;height:28px;display:grid;place-items:center;border:1px solid color-mix(in srgb,var(--bio-success) 34%,var(--bio-border));border-radius:7px;color:var(--bio-success)}.dsh-bio-handoff__icon>svg{width:15px}.dsh-bio-handoff__icon>.dsh-bio-spinner{width:15px;height:15px;margin:0}.dsh-bio-handoff__body{min-width:0}.dsh-bio-handoff__heading{display:flex;align-items:center;gap:8px}.dsh-bio-handoff__heading strong{font-size:13px}.dsh-bio-handoff__body p{margin-top:2px;color:var(--bio-muted);font-size:12px}.dsh-bio-handoff__body small{display:block;margin-top:3px;color:var(--bio-subtle);font-size:12px;line-height:1.45}.dsh-bio-handoff__action{min-height:36px;padding:6px 10px;border:1px solid var(--bio-border-2);border-radius:7px;background:transparent;color:var(--bio-text);font-weight:610;cursor:pointer;white-space:nowrap}.dsh-bio-handoff__action:hover{background:var(--bio-hover)}.dsh-bio-loading,.dsh-bio-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--bio-muted)}.dsh-bio-loading{min-height:360px}.dsh-bio-loading p,.dsh-bio-empty span{margin-top:5px;color:var(--bio-subtle);font-size:12px}.dsh-bio-empty{min-height:160px;padding:24px}.dsh-bio-empty>svg{margin-bottom:10px;color:var(--bio-subtle)}.dsh-bio-spinner{width:18px;height:18px;margin-bottom:12px;border:2px solid var(--bio-border-2);border-top-color:var(--bio-primary);border-radius:50%;animation:dsh-bio-spin .8s linear infinite}@keyframes dsh-bio-spin{to{transform:rotate(360deg)}}
.dsh-bio-sidebar-action{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:0 0 calc(100% + 8px);width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;overflow:hidden}.dsh-bio-sidebar-action:hover,.dsh-bio-sidebar-action[data-open]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}.dsh-bio-sidebar-action span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bio-sidebar-action[data-rail]{flex:0 0 36px;justify-content:center;gap:0;width:36px;height:36px;margin:4px 0;padding:0;border-radius:50%}:has(>.dsh-bio-sidebar-action),:has(>*>.dsh-bio-sidebar-action){flex-wrap:wrap}
.dsh-bio-graph{--bio-text:var(--dsw-alias-label-primary,#f2f3f5);--bio-muted:var(--dsw-alias-label-secondary,#aeb4bf);--bio-subtle:var(--dsw-alias-label-tertiary,#858d9b);--bio-layer:var(--dsw-alias-bg-layer-1,#171a20);--bio-layer-2:var(--dsw-alias-bg-layer-2,#1d2027);--bio-border:var(--dsw-alias-border-l1,rgba(255,255,255,.11));--bio-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.18));--bio-primary:var(--dsw-alias-button-primary-fill,#5b5cf0);--bio-success:var(--dsw-alias-status-success,#42bf79);--bio-warning:var(--dsw-alias-status-warning,#e5ad3d);color:var(--bio-text);border:1px solid var(--bio-border);border-radius:9px;overflow:hidden;background:var(--bio-layer);font-family:var(--dsw-font-family,Inter,ui-sans-serif,system-ui,sans-serif)}.dsh-bio-graph__bar,.dsh-bio-graph__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px}.dsh-bio-graph__bar{border-bottom:1px solid var(--bio-border)}.dsh-bio-graph__bar>div{display:flex;min-width:0;flex-direction:column}.dsh-bio-graph__bar strong{font-size:13px}.dsh-bio-graph__bar span:not(.dsh-bio-badge){color:var(--bio-subtle);font-size:11px}.dsh-bio-graph__viewport{overflow:auto;min-height:220px;max-height:440px;background-color:var(--dsw-alias-bg-base,#111318);background-image:radial-gradient(circle,var(--bio-border) .7px,transparent .8px);background-size:16px 16px}.dsh-bio-graph svg{display:block;min-width:720px;width:100%;height:auto}.dsh-bio-graph__edge{fill:none;stroke:color-mix(in srgb,var(--bio-subtle) 70%,transparent);stroke-width:1.4}.dsh-bio-graph__edge[data-kind=control]{stroke-dasharray:5 4}.dsh-bio-graph__arrow{fill:var(--bio-subtle)}.dsh-bio-graph__node{cursor:pointer}.dsh-bio-graph__node rect{fill:var(--bio-layer-2);stroke:var(--bio-border-2);stroke-width:1}.dsh-bio-graph__node:hover rect,.dsh-bio-graph__node[data-selected] rect{stroke:var(--bio-primary);stroke-width:1.7}.dsh-bio-graph__node[data-kind=workflow-input] rect,.dsh-bio-graph__node[data-kind=workflow-output] rect{fill:color-mix(in srgb,#3d8bfd 9%,var(--bio-layer-2));stroke:color-mix(in srgb,#3d8bfd 52%,var(--bio-border))}.dsh-bio-graph__node[data-kind=call] rect{fill:color-mix(in srgb,var(--bio-primary) 10%,var(--bio-layer-2));stroke:color-mix(in srgb,var(--bio-primary) 50%,var(--bio-border))}.dsh-bio-graph__node[data-kind=scatter] rect,.dsh-bio-graph__node[data-kind=conditional] rect{fill:color-mix(in srgb,var(--bio-warning) 9%,var(--bio-layer-2));stroke:color-mix(in srgb,var(--bio-warning) 52%,var(--bio-border))}.dsh-bio-graph__kind{fill:var(--bio-subtle);font-size:9px;font-family:var(--dsw-font-mono,ui-monospace,monospace);letter-spacing:.08em}.dsh-bio-graph__label{fill:var(--bio-text);font-size:13px;font-weight:600}.dsh-bio-graph__ports{fill:var(--bio-subtle);font-size:9px}.dsh-bio-graph__footer{border-top:1px solid var(--bio-border);color:var(--bio-subtle);font-size:11px}.dsh-bio-graph__selection{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:14px;padding:10px 12px;border-top:1px solid var(--bio-border);font-size:11px}.dsh-bio-graph__selection>div{display:flex;flex-direction:column}.dsh-bio-graph__selection>div span,.dsh-bio-graph__selection p{color:var(--bio-subtle)}.dsh-bio-graph__selection p{margin:0}.dsh-bio-graph__selection button{border:1px solid var(--bio-border);border-radius:6px;background:transparent;color:var(--bio-muted);padding:5px 8px;cursor:pointer}.dsh-bio-graph__diagnostics{list-style:none;margin:0;padding:0;border-top:1px solid var(--bio-border)}.dsh-bio-graph__diagnostics li{display:flex;gap:9px;padding:9px 12px;color:var(--bio-muted);font-size:11px}.dsh-bio-graph__diagnostics li+li{border-top:1px solid var(--bio-border)}.dsh-bio-graph__diagnostics strong{color:var(--bio-warning);font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dsh-bio-tool-state{display:flex;align-items:center;gap:9px;padding:14px;color:var(--dsw-alias-label-secondary,#aeb4bf);font-size:12px}.dsh-bio-tool-state .dsh-bio-spinner{margin:0}.dsh-bio-tool-state--error{color:var(--dsw-alias-status-error,#ef6a72)}
.dsh-bio-result{--bio-text:var(--dsw-alias-label-primary,#f2f3f5);--bio-muted:var(--dsw-alias-label-secondary,#aeb4bf);--bio-subtle:var(--dsw-alias-label-tertiary,#858d9b);--bio-layer:var(--dsw-alias-bg-layer-1,#171a20);--bio-layer-2:var(--dsw-alias-bg-layer-2,#1d2027);--bio-border:var(--dsw-alias-border-l1,rgba(255,255,255,.11));--bio-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.18));--bio-primary:var(--dsw-alias-button-primary-fill,#5b5cf0);--bio-success:var(--dsw-alias-status-success,#42bf79);--bio-warning:var(--dsw-alias-status-warning,#e5ad3d);--bio-error:var(--dsw-alias-status-error,#ef6a72);color:var(--bio-text);border:1px solid var(--bio-border);border-radius:9px;overflow:hidden;background:var(--bio-layer);font-family:var(--dsw-font-family,Inter,ui-sans-serif,system-ui,sans-serif);font-size:13px;line-height:1.5;overflow-wrap:anywhere}.dsh-bio-result *{box-sizing:border-box}.dsh-bio-result h3,.dsh-bio-result h4,.dsh-bio-result p,.dsh-bio-result dl,.dsh-bio-result dd{margin:0}.dsh-bio-result ul,.dsh-bio-result ol{list-style:none;margin:0;padding:0}.dsh-bio-result code{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;font-variant-numeric:tabular-nums}.dsh-bio-result .dsh-bio-badge--error,.dsh-bio-result .dsh-bio-status--error{color:color-mix(in srgb,var(--bio-error) 78%,var(--bio-text));border-color:color-mix(in srgb,var(--bio-error) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-error) 9%,transparent)}
.dsh-bio-result__header{min-height:50px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 13px;border-bottom:1px solid var(--bio-border)}.dsh-bio-result__header>div{display:flex;align-items:center;min-width:0;gap:10px}.dsh-bio-result__header>div>svg{width:18px;height:18px;flex:none;color:var(--bio-subtle)}.dsh-bio-result__header>div>span{display:flex;min-width:0;flex-direction:column}.dsh-bio-result__header strong{font-size:13px}.dsh-bio-result__header small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bio-subtle);font-size:11px}
.dsh-bio-result__outcome{display:grid;grid-template-columns:38px minmax(0,1fr);gap:13px;padding:18px 16px;background:var(--bio-layer-2)}.dsh-bio-result__outcome-icon{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--bio-border-2);border-radius:8px;color:var(--bio-subtle)}.dsh-bio-result__outcome-icon svg{width:18px}.dsh-bio-result[data-tone=success] .dsh-bio-result__outcome-icon{color:var(--bio-success);border-color:color-mix(in srgb,var(--bio-success) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-success) 8%,transparent)}.dsh-bio-result[data-tone=warning] .dsh-bio-result__outcome-icon{color:var(--bio-warning);border-color:color-mix(in srgb,var(--bio-warning) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-warning) 8%,transparent)}.dsh-bio-result[data-tone=error] .dsh-bio-result__outcome-icon{color:var(--bio-error);border-color:color-mix(in srgb,var(--bio-error) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-error) 8%,transparent)}.dsh-bio-result__outcome h3{font-size:16px;letter-spacing:-.015em}.dsh-bio-result__outcome p{max-width:72ch;margin-top:3px;color:var(--bio-muted)}
.dsh-bio-result__section{padding:16px;border-top:1px solid var(--bio-border)}.dsh-bio-result__section-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:12px}.dsh-bio-result__section-heading h4{font-size:13px}.dsh-bio-result__section-heading p{margin-top:2px;color:var(--bio-subtle);font-size:11px}.dsh-bio-result__section-heading>span{flex:none;color:var(--bio-muted);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-bio-result__qc-counts{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-result__qc-counts>div{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:9px 10px}.dsh-bio-result__qc-counts>div+div{border-left:1px solid var(--bio-border)}.dsh-bio-result__qc-counts dt{color:var(--bio-subtle);font-size:11px}.dsh-bio-result__qc-counts dd{font-size:15px;font-weight:650;font-variant-numeric:tabular-nums}.dsh-bio-result__qc-counts [data-tone=success] dd{color:var(--bio-success)}.dsh-bio-result__qc-counts [data-tone=warning] dd{color:var(--bio-warning)}.dsh-bio-result__qc-counts [data-tone=error] dd{color:var(--bio-error)}
.dsh-bio-result__samples,.dsh-bio-result__outputs{border-bottom:1px solid var(--bio-border)}.dsh-bio-result__samples li,.dsh-bio-result__outputs li{display:flex;align-items:center;justify-content:space-between;gap:14px;min-width:0;padding:10px 2px;border-top:1px solid var(--bio-border)}.dsh-bio-result__samples li>span:first-child,.dsh-bio-result__outputs li>span:first-child{display:flex;min-width:0;flex-direction:column}.dsh-bio-result__samples strong,.dsh-bio-result__outputs strong{font-size:12px}.dsh-bio-result__samples small,.dsh-bio-result__outputs code{color:var(--bio-subtle)}.dsh-bio-result__outputs li>span:last-child{flex:none;color:var(--bio-muted);font-size:11px;font-variant-numeric:tabular-nums}
.dsh-bio-result__diagnostics{margin-top:12px!important;border-top:1px solid var(--bio-border)}.dsh-bio-result__diagnostics li{display:flex;gap:10px;padding:8px 2px;color:var(--bio-muted);font-size:11px;border-bottom:1px solid var(--bio-border)}.dsh-bio-result__diagnostics strong{color:var(--bio-warning);font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dsh-bio-result__bounded-note{padding-top:10px;color:var(--bio-subtle);font-size:11px}
.dsh-bio-result__interpretation{padding:11px 16px;border-top:1px solid var(--bio-border);color:var(--bio-muted);font-size:11px;background:color-mix(in srgb,var(--bio-primary) 5%,var(--bio-layer))}.dsh-bio-result__evidence{border-top:1px solid var(--bio-border)}.dsh-bio-result__evidence>summary{min-height:46px;display:flex;align-items:center;gap:10px;padding:0 16px;list-style:none;color:var(--bio-muted);cursor:pointer}.dsh-bio-result__evidence>summary::-webkit-details-marker{display:none}.dsh-bio-result__evidence>summary>span{font-weight:620}.dsh-bio-result__evidence>summary>small{margin-left:auto;color:var(--bio-subtle)}.dsh-bio-result__evidence>summary:after{content:"";width:7px;height:7px;flex:none;border-right:1px solid currentColor;border-bottom:1px solid currentColor;transform:rotate(45deg) translateY(-2px);transform-origin:center}.dsh-bio-result__evidence[open]>summary:after{transform:rotate(225deg) translate(-1px,-1px)}.dsh-bio-result__evidence-body{padding:0 16px 16px;border-top:1px solid var(--bio-border);background:var(--bio-layer-2)}.dsh-bio-result__facts{border-top:0}.dsh-bio-result__facts>div{display:grid;grid-template-columns:110px minmax(0,1fr);gap:14px;padding:9px 0;border-bottom:1px solid var(--bio-border)}.dsh-bio-result__facts dt{color:var(--bio-subtle)}.dsh-bio-result__facts dd{min-width:0;text-align:right;color:var(--bio-muted)}.dsh-bio-result__checksums{margin-top:14px}.dsh-bio-result__checksums h4{margin-bottom:5px;font-size:12px}.dsh-bio-result__checksums>div{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--bio-border)}.dsh-bio-result__checksums>div>span{display:flex;min-width:0;flex-direction:column}.dsh-bio-result__checksums strong{font-size:11px}.dsh-bio-result__checksums small,.dsh-bio-result__checksums>p{color:var(--bio-subtle);font-size:10px}.dsh-bio-result__checksums>code{flex:none;color:var(--bio-subtle)}.dsh-bio-result__privacy{margin-top:14px!important;color:var(--bio-subtle);font-size:11px}
.dsh-bio-result__history{padding:0 14px!important}.dsh-bio-result__history li{position:relative;display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:11px;padding:13px 0;border-bottom:1px solid var(--bio-border)}.dsh-bio-result__history-track{position:relative;width:9px;height:9px;margin-top:5px;border:2px solid var(--bio-subtle);border-radius:50%}.dsh-bio-result__history-track:after{content:"";position:absolute;top:10px;left:2px;width:1px;height:calc(100% + 25px);background:var(--bio-border-2)}.dsh-bio-result__history li:last-child .dsh-bio-result__history-track:after{display:none}.dsh-bio-result__history li>div{min-width:0}.dsh-bio-result__history strong{font-size:12px}.dsh-bio-result__history p{margin-top:1px;color:var(--bio-muted);font-size:11px}.dsh-bio-result__history small{display:block;margin-top:3px;color:var(--bio-subtle);font-size:10px;font-variant-numeric:tabular-nums}.dsh-bio-result--history>.dsh-bio-result__bounded-note{padding:11px 14px}.dsh-bio-result__empty{display:flex;min-height:150px;align-items:center;justify-content:center;flex-direction:column;padding:24px;text-align:center;color:var(--bio-muted)}.dsh-bio-result__empty>svg{margin-bottom:8px;color:var(--bio-subtle)}.dsh-bio-result__empty p{max-width:56ch;margin-top:4px;color:var(--bio-subtle);font-size:11px}
@media(max-width:980px){.dsh-bio-area--workflows{grid-template-columns:1fr}.dsh-bio-main-pane{border-right:0}.dsh-bio-inspector{border-top:1px solid var(--bio-border)}.dsh-bio-workflow-table__head,.dsh-bio-workflow-table__body>button{grid-template-columns:minmax(190px,1fr) minmax(110px,150px) minmax(110px,150px) 118px}}
.dsh-bio-graph__viewport{background-image:none;background-color:var(--dsw-alias-bg-base,#111318)}
@media(max-width:760px){.dsh-bio-center{inset:0;border:0;border-radius:0}.dsh-bio-center__header{height:58px;padding:0 12px}.dsh-bio-center__identity p{display:none}.dsh-bio-center__header-meta>.dsh-bio-badge{font-size:0}.dsh-bio-center__header-meta>.dsh-bio-badge:after{content:attr(data-compact-label);font-size:11px}.dsh-bio-center__body{display:flex;flex-direction:column}.dsh-bio-nav{flex:none;flex-direction:row;overflow:auto;padding:7px;border-right:0;border-bottom:1px solid var(--bio-border)}.dsh-bio-nav>button,.dsh-bio-nav__utility>button{min-width:max-content;height:38px}.dsh-bio-nav__utility{flex:none;margin-top:0;padding:0 0 0 6px;border-top:0;border-left:1px solid var(--bio-border)}.dsh-bio-nav__foot{display:none}.dsh-bio-content{flex:1}.dsh-bio-main-pane,.dsh-bio-workbench,.dsh-bio-inspector{padding:18px 14px}.dsh-bio-area--single{padding:0}.dsh-bio-workbench__split{grid-template-columns:1fr}.dsh-bio-workbench__split>form+form,.dsh-bio-run-plan{border-left:0;border-top:1px solid var(--bio-border)}.dsh-bio-workbench__split>form,.dsh-bio-run-plan,.dsh-bio-disclosure--panel>form{padding:18px 4px}.dsh-bio-brief{padding:18px 4px}.dsh-bio-brief__grid{grid-template-columns:1fr}.dsh-bio-brief__grid>.dsh-bio-field:first-child{grid-column:auto}.dsh-bio-brief__footer{align-items:flex-start;flex-direction:column}.dsh-bio-brief__footer .dsh-bio-button{width:100%}.dsh-bio-run-strip{grid-template-columns:1fr 1fr}.dsh-bio-run-strip>div:nth-child(3){border-left:0;border-top:1px solid var(--bio-border)}.dsh-bio-run-strip>div:nth-child(4){border-top:1px solid var(--bio-border)}.dsh-bio-workflow-table__head{display:none}.dsh-bio-workflow-table__body>button{grid-template-columns:minmax(0,1fr) auto;gap:6px}.dsh-bio-workflow-table__body>button>span:nth-child(2),.dsh-bio-workflow-table__body>button>span:nth-child(3){grid-column:1/-1}.dsh-bio-workflow-table__body>button>span:nth-child(4){grid-column:2;grid-row:1}.dsh-bio-readiness-summary{grid-template-columns:32px minmax(0,1fr)}.dsh-bio-readiness-summary>.dsh-bio-status{grid-column:2}.dsh-bio-setup-footer{align-items:flex-start;flex-direction:column}.dsh-bio-graph__selection{grid-template-columns:1fr auto}.dsh-bio-graph__selection>p{display:none}}
@media(max-width:760px){.dsh-bio-nav>button,.dsh-bio-nav__utility>button{gap:6px;padding:0 7px;font-size:12px}}
@media(max-width:760px){.dsh-bio-handoff{grid-template-columns:28px minmax(0,1fr);margin:10px 10px 0;padding:10px 11px}.dsh-bio-handoff__action{grid-column:2;justify-self:start;white-space:normal}}
@media(max-width:620px){.dsh-bio-result__section-heading{flex-direction:column;gap:5px}.dsh-bio-result__qc-counts{grid-template-columns:1fr}.dsh-bio-result__qc-counts>div+div{border-left:0;border-top:1px solid var(--bio-border)}.dsh-bio-result__samples li,.dsh-bio-result__outputs li{align-items:flex-start;flex-direction:column;gap:5px}.dsh-bio-result__facts>div{grid-template-columns:1fr;gap:2px}.dsh-bio-result__facts dd{text-align:left}.dsh-bio-result__checksums>div{align-items:flex-start;flex-direction:column;gap:4px}.dsh-bio-result__history li{grid-template-columns:18px minmax(0,1fr)}.dsh-bio-result__history li>.dsh-bio-badge{grid-column:2}}
@media(prefers-reduced-motion:reduce){.dsh-bio-center{animation:none}.dsh-bio-spinner{animation-duration:1.8s}.dsh-bio-disclosure>summary:after{transition:none}}
`;
		//#endregion
		//#region src/client/index.tsx
		const inject = ["slots", "sessions"];
		function installStyles() {
			if (document.getElementById("dsh-bio-workflows-style") !== null) return;
			const style = document.createElement("style");
			style.id = "dsh-bio-workflows-style";
			style.dataset.plugin = "dsh-bio-workflows";
			style.textContent = STYLE;
			document.head.append(style);
		}
		function createOpenState() {
			let open = false;
			const listeners = /* @__PURE__ */ new Set();
			return {
				getSnapshot: () => open,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				set(next) {
					if (next === open) return;
					open = next;
					for (const listener of listeners) listener();
				}
			};
		}
		function apply(ctx) {
			installStyles();
			const slots = ctx.get("slots");
			const sessions = ctx.get("sessions");
			if (!slots || !sessions) return;
			const state = createOpenState();
			slots.inject("shell.overlay", () => slots.register({
				name: "shell.overlay",
				id: "bio-workflows-center"
			}, function WorkflowCenterOverlay() {
				const open = (0, react.useSyncExternalStore)(state.subscribe, state.getSnapshot);
				const close = (0, react.useCallback)(() => {
					state.set(false);
				}, []);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowCenter, {
					sessions,
					open,
					onClose: close
				});
			}));
			slots.inject("sidebar.footer.action", () => slots.register({
				name: "sidebar.footer.action",
				id: "bio-workflows-center",
				order: 220
			}, function WorkflowCenterAction({ wide }) {
				const open = (0, react.useSyncExternalStore)(state.subscribe, state.getSnapshot);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: "dsh-bio-sidebar-action",
					"data-open": open || void 0,
					"data-rail": !wide || void 0,
					"aria-expanded": open,
					"aria-label": "Bio Workflows",
					title: "Open Bio Workflows",
					onClick: () => {
						state.set(!open);
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}), wide && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Bio Workflows" })]
				});
			}));
			slots.inject("tool.call.toolview", () => slots.register({
				name: "tool.call.toolview",
				key: "bio_workflows_draft_graph"
			}, DraftGraphToolView));
			slots.inject("tool.call.toolview", () => slots.register({
				name: "tool.call.toolview",
				key: "bio_workflows_run_list"
			}, RunListToolView));
			slots.inject("tool.call.toolview", () => slots.register({
				name: "tool.call.toolview",
				key: "bio_workflows_run_get"
			}, RunResultToolView));
		}
		//#endregion
		exports.DraftGraphToolView = DraftGraphToolView;
		exports.RunListToolView = RunListToolView;
		exports.RunResultToolView = RunResultToolView;
		exports.WorkflowCenter = WorkflowCenter;
		exports.WorkflowGraphView = WorkflowGraphView;
		exports.apply = apply;
		exports.inject = inject;
		exports.layoutWorkflowGraph = layoutWorkflowGraph;
		exports.projectRunGetToolResult = projectRunGetToolResult;
		exports.projectRunListToolResult = projectRunListToolResult;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map