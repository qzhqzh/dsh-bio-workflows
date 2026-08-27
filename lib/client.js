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
		function workflowIdentity(workflow) {
			return `${workflow.id}@${workflow.version} with bundle digest ${workflow.digest}`;
		}
		const prompts = {
			validateWorkflow(workflow) {
				return `Use dsh-bio-workflows to validate the exact ${workflowIdentity(workflow)} bundle. Explain every diagnostic and do not run the workflow.`;
			},
			prepareWorkflow(workflow) {
				return `Help me prepare a safe run of ${workflowIdentity(workflow)}. First ask for any missing real input paths, then call bio_workflows_plan. Do not call bio_workflows_run until I review the plan and approve it.`;
			},
			createDraft(value) {
				return `Create an owner-scoped AI WDL draft using bio_workflows_draft_create with id ${JSON.stringify(value.id)}, name ${JSON.stringify(value.name)}, and summary ${JSON.stringify(value.summary)}. After creation, read revision 1 and propose the next source edit. Treat the draft as untrusted and non-executable.`;
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
				return "Use bio_workflows_run_list to list my owner-scoped workflow runs, newest first. Summarize status, workflow identity, and the next safe action for failures. Do not start a new run.";
			},
			inspectRun(runId) {
				return `Use bio_workflows_run_get to inspect owner-scoped run ${runId}. Summarize status, provenance, checksummed outputs, and any normalized bioinformatics results. Do not retry or start another run.`;
			},
			diagnoseSetup() {
				return "Inspect dsh-bio-workflows capabilities with bio_workflows_info. Diagnose the workflow store, miniwdl 1.15.0 validator, Docker, DSH jobs, and the configured input/run roots. Make no configuration changes unless I explicitly approve them.";
			}
		};
		//#endregion
		//#region src/client/WorkflowCenter.tsx
		const AREAS = [
			{
				id: "workflows",
				label: "Workflows",
				icon: WorkflowIcon
			},
			{
				id: "drafts",
				label: "AI Drafts",
				icon: DraftIcon
			},
			{
				id: "runs",
				label: "Runs",
				icon: RunsIcon
			},
			{
				id: "setup",
				label: "Setup",
				icon: SetupIcon
			}
		];
		const EMPTY_BOOTSTRAP = {
			schemaVersion: "1",
			package: {
				name: "dsh-bio-workflows",
				version: "0.11.0"
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
			"a[href]",
			"[tabindex]:not([tabindex=\"-1\"])"
		].join(",");
		function focusableElements(root) {
			return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
		}
		async function defaultLoadBootstrap(signal) {
			const response = await fetch("/api/bio-workflows/v1/bootstrap", {
				method: "GET",
				headers: { accept: "application/json" },
				cache: "no-store",
				signal
			});
			if (!response.ok) throw new Error(`Workflow Center bootstrap failed (${response.status})`);
			const value = await response.json();
			if (value === null || typeof value !== "object" || value.schemaVersion !== "1" || !Array.isArray(value.workflows) || value.workflows?.some((workflow) => workflow === null || typeof workflow !== "object" || typeof workflow.executionSupported !== "boolean") === true) throw new Error("Workflow Center bootstrap returned an incompatible payload");
			return value;
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
					...workflow.tags
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
								children: "Workflow catalog"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Verified WDL bundles available to the current plugin host." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
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
								placeholder: "Search name, tag, or source",
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
										children: "Source"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "WDL"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										role: "columnheader",
										children: "Status"
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
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-bio-source",
												children: workflow.source
											})
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "cell",
											children: workflow.languageVersion
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											role: "cell",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: `dsh-bio-status dsh-bio-status--${statusTone(workflow.status)}`,
												children: workflow.status
											})
										})
									]
								}, `${workflow.id}@${workflow.version}:${workflow.source}`)), filtered.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-empty",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchIcon, {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "No matching workflows" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Try a workflow id such as fastq-qc or bam-qc." })
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dl", {
							className: "dsh-bio-facts",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Trust" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.trust })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Verification" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.verification.status })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Execution" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.executionSupported ? "Allowlisted" : "Validation only" })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Engine" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: selected.engines.map((engine) => engine.name).join(", ") })] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("dt", { children: "Digest" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("dd", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("code", {
									title: selected.digest,
									children: [selected.digest.slice(0, 17), "…"]
								}) })] })
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bio-tags",
							children: selected.tags.map((tag) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: tag }, tag))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bio-lane",
							"aria-label": "Safe workflow lifecycle",
							children: (selected.executionSupported ? [
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Not execution-allowlisted" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "This bundle can be inspected and validated, but 0.11.0 will not plan or run it." })] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
								disabled: busy,
								onClick: () => {
									ask(prompts.validateWorkflow(selected));
								},
								children: "Ask Agent to validate"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
								secondary: true,
								disabled: busy || !selected.executionSupported,
								onClick: () => {
									ask(prompts.prepareWorkflow(selected));
								},
								children: "Prepare a safe run"
							})]
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
			const [draft, setDraft] = (0, react.useState)({
				id: "",
				name: "",
				summary: ""
			});
			const [draftId, setDraftId] = (0, react.useState)("");
			const [revision, setRevision] = (0, react.useState)("1");
			const [missionId, setMissionId] = (0, react.useState)("");
			const [fixtureId, setFixtureId] = (0, react.useState)("text-roundtrip");
			const [fixtureVersion, setFixtureVersion] = (0, react.useState)("1.0.0");
			const [testId, setTestId] = (0, react.useState)("");
			const validCreate = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(draft.id) && draft.name.trim() !== "" && draft.summary.trim() !== "";
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
								children: "AI-assisted WDL drafts"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The Agent writes; deterministic tools own revisions, validation, and graph facts." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `dsh-bio-badge ${draftWritesEnabled ? "" : "dsh-bio-badge--warning"}`,
								children: draftWritesEnabled ? "Owner-scoped" : "Writes off"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-workbench__split",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								onSubmit: (event) => {
									event.preventDefault();
									if (validCreate && draftWritesEnabled) ask(prompts.createDraft(draft));
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-bio-section-title",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DraftIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Start a draft" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Create revision 1 from a deterministic WDL template." })] })]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: "Workflow id",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: draft.id,
											onChange: (event) => {
												setDraft({
													...draft,
													id: event.target.value
												});
											},
											placeholder: "rna-seq-qc"
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: "Name",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											value: draft.name,
											onChange: (event) => {
												setDraft({
													...draft,
													name: event.target.value
												});
											},
											placeholder: "RNA sequencing QC"
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: "Purpose",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
											value: draft.summary,
											onChange: (event) => {
												setDraft({
													...draft,
													summary: event.target.value
												});
											},
											placeholder: "Describe inputs, outputs, and the biological question.",
											rows: 4
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										className: "dsh-bio-button",
										type: "submit",
										disabled: !validCreate || busy || !draftWritesEnabled,
										title: draftWritesEnabled ? void 0 : "Enable draft writes in the Host configuration first.",
										children: ["Create with Agent", /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArrowIcon, {})]
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								onSubmit: (event) => {
									event.preventDefault();
									if (validExisting) ask(prompts.graphDraft(draftId, Number(revision)));
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
												ask(prompts.validateDraft(draftId, Number(revision)));
											},
											children: "Validate revision"
										})]
									})
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-trust-note",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Source is authoritative" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Every update requires both the current revision and content digest. A conflict stops the write; reload and merge explicitly." })] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-workbench__split dsh-bio-workbench__split--runs",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								onSubmit: (event) => {
									event.preventDefault();
									if (validMission && isolatedTestConfigured) ask(prompts.prepareDraftTest(missionId, fixtureId, fixtureVersion));
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
									if (validTest) ask(prompts.inspectDraftTest(testId));
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
								children: "Runs and provenance"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Owner-scoped history stays behind the current Agent and plugin tools." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								className: "dsh-bio-button dsh-bio-button--secondary",
								type: "button",
								disabled: busy,
								onClick: () => {
									ask(prompts.listRuns());
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RefreshIcon, {}), "List my runs"]
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
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
								onSubmit: (event) => {
									event.preventDefault();
									if (validRunId) ask(prompts.inspectRun(runId));
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-bio-section-title",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RunsIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "Inspect a run" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "Read status, provenance, and checksummed results." })] })]
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
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
										disabled: busy || !selected.executionSupported,
										onClick: () => {
											ask(prompts.prepareWorkflow(selected));
										},
										children: selected.executionSupported ? "Ask Agent to plan" : "Execution unavailable"
									})
								] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-bio-empty",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(WorkflowIcon, {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "No workflow selected" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Select one in Workflows first." })
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
		function SetupArea({ bootstrap, ask, busy }) {
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
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dsh-bio-readiness",
							children: Object.entries(READINESS_COPY).map(([key, [label, description, onLabel = "Ready", offLabel = "Off"]]) => {
								const ready = bootstrap.readiness[key] === true;
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `dsh-bio-readiness__icon dsh-bio-readiness__icon--${ready ? "ready" : "off"}`,
										children: ready ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: description })] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: `dsh-bio-status dsh-bio-status--${ready ? "success" : "neutral"}`,
										children: ready ? onLabel : offLabel
									})
								] }, key);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-setup-footer",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Need a complete check?" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "The Agent can inspect miniwdl, Docker, jobs, roots, and policy without changing them." })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AgentButton, {
								disabled: busy,
								onClick: () => {
									ask(prompts.diagnoseSetup());
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
			const centerRef = (0, react.useRef)(null);
			const previousFocusRef = (0, react.useRef)(null);
			const subscribeSessions = (0, react.useMemo)(() => (listener) => sessions.list.subscribe(listener), [sessions]);
			const currentSessionSnapshot = (0, react.useMemo)(() => () => sessions.list.getSnapshot().current, [sessions]);
			const currentSessionId = (0, react.useSyncExternalStore)(subscribeSessions, currentSessionSnapshot, currentSessionSnapshot);
			const agentAvailable = currentSessionId !== void 0 && sessions.binding(currentSessionId) !== void 0;
			const actionsDisabled = busy || !agentAvailable;
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				setLoading(true);
				setLoadError(null);
				loadBootstrap(controller.signal).then((value) => {
					setBootstrap(value);
					setSelectedDigest((current) => current !== null && value.workflows.some((workflow) => workflow.digest === current) ? current : value.workflows.find((workflow) => workflow.executionSupported)?.digest ?? value.workflows[0]?.digest ?? null);
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
						onClose();
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
			}, [onClose, open]);
			const selected = bootstrap.workflows.find((workflow) => workflow.digest === selectedDigest);
			const catalogDiagnostic = bootstrap.diagnostics[0];
			const catalogDiagnosticMessage = catalogDiagnostic?.message ?? catalogDiagnostic?.code ?? "A local workflow catalog entry could not be loaded.";
			const ask = (text) => {
				if (!agentAvailable) {
					setNotice({
						tone: "error",
						message: "Open a Harness task before asking the Agent."
					});
					return;
				}
				setBusy(true);
				setNotice(null);
				sendToAgent(sessions, text).then(() => {
					setNotice({
						tone: "success",
						message: "Request queued in the current Harness task."
					});
					window.setTimeout(onClose, 350);
				}).catch((error) => {
					setNotice({
						tone: "error",
						message: error instanceof Error ? error.message : String(error)
					});
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
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: "WDL authoring, graph review, and trusted execution" })] })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-bio-center__header-meta",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: `dsh-bio-badge ${agentAvailable ? "dsh-bio-badge--success" : "dsh-bio-badge--warning"}`,
							"aria-live": "polite",
							children: agentAvailable ? "Agent connected" : "Open a Harness task"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							"data-initial-focus": true,
							type: "button",
							className: "dsh-bio-icon-button",
							"aria-label": "Close Workflow Center",
							title: "Close",
							onClick: onClose,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CloseIcon, {})
						})]
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dsh-bio-center__body",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("nav", {
						className: "dsh-bio-nav",
						"aria-label": "Workflow Center areas",
						children: [AREAS.map(({ id, label, icon: Icon }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							"data-active": area === id || void 0,
							"aria-current": area === id ? "page" : void 0,
							onClick: () => {
								setArea(id);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label })]
						}, id)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-bio-nav__foot",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Control plane" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: "Harness Agent" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: "Tools remain authoritative" })
							]
						})]
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
								className: notice.tone === "error" ? "dsh-bio-banner dsh-bio-banner--error" : "dsh-bio-banner",
								role: notice.tone === "error" ? "alert" : "status",
								children: [notice.tone === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(WarningIcon, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CheckIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: notice.message })]
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
		const DIGEST = /^sha256:[a-f0-9]{64}$/;
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
		const MAX_TOOL_CONTENT_BLOCKS = 128;
		function isRecord(value) {
			return value !== null && typeof value === "object" && !Array.isArray(value);
		}
		function isBoundedString(value, maximum) {
			return typeof value === "string" && value.length > 0 && value.length <= maximum;
		}
		function isPosition(value) {
			return isRecord(value) && typeof value.line === "number" && Number.isSafeInteger(value.line) && value.line >= 1 && typeof value.column === "number" && Number.isSafeInteger(value.column) && value.column >= 1 && typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0;
		}
		function isRange(value) {
			return isRecord(value) && value.path === "main.wdl" && isPosition(value.start) && isPosition(value.end) && Number(value.end.offset) >= Number(value.start.offset);
		}
		function isPort(value) {
			return isRecord(value) && isBoundedString(value.id, 160) && isBoundedString(value.name, 160) && isBoundedString(value.type, 256);
		}
		function hasUniqueIds(values) {
			const ids = values.map((value) => isRecord(value) ? value.id : void 0);
			return ids.every((id) => typeof id === "string") && new Set(ids).size === ids.length;
		}
		function isNode(value) {
			if (!isRecord(value) || !isBoundedString(value.id, 240) || typeof value.kind !== "string" || !NODE_KINDS.has(value.kind) || !isBoundedString(value.label, 240) || !isRange(value.range) || !Array.isArray(value.inputs) || value.inputs.length > 128 || !value.inputs.every(isPort) || !hasUniqueIds(value.inputs) || !Array.isArray(value.outputs) || value.outputs.length > 128 || !value.outputs.every(isPort) || !hasUniqueIds(value.outputs)) return false;
			if (value.target !== void 0 && !isBoundedString(value.target, 240)) return false;
			if (value.parentGroup !== void 0 && !isBoundedString(value.parentGroup, 240)) return false;
			return true;
		}
		function isEndpoint(value) {
			return isRecord(value) && isBoundedString(value.node, 240) && isBoundedString(value.port, 160);
		}
		function isEdge(value) {
			return isRecord(value) && isBoundedString(value.id, 96) && typeof value.kind === "string" && EDGE_KINDS.has(value.kind) && isEndpoint(value.from) && isEndpoint(value.to);
		}
		function isDiagnostic(value) {
			return isRecord(value) && isBoundedString(value.code, 96) && (value.severity === "warning" || value.severity === "error") && isBoundedString(value.message, 1e3) && (value.range === void 0 || isRange(value.range));
		}
		function isWorkflowGraph(value) {
			if (!isRecord(value) || value.schemaVersion !== "1" || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 256 || typeof value.draftId !== "string" || !DRAFT_ID.test(value.draftId) || typeof value.contentDigest !== "string" || !DIGEST.test(value.contentDigest) || typeof value.graphDigest !== "string" || !DIGEST.test(value.graphDigest) || value.sourcePath !== "main.wdl" || !isBoundedString(value.languageVersion, 32) || typeof value.complete !== "boolean" || !isRecord(value.workflow) || !isBoundedString(value.workflow.name, 128) || !isRange(value.workflow.range) || !Array.isArray(value.nodes) || value.nodes.length > 512 || !value.nodes.every(isNode) || !hasUniqueIds(value.nodes) || !Array.isArray(value.edges) || value.edges.length > 2048 || !value.edges.every(isEdge) || !hasUniqueIds(value.edges) || !Array.isArray(value.diagnostics) || value.diagnostics.length > 128 || !value.diagnostics.every(isDiagnostic) || value.executionAuthorized !== false) return false;
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
			if (!Array.isArray(block.content) || block.content.length > MAX_TOOL_CONTENT_BLOCKS) return { error: "The graph result exceeds the safe replay limit." };
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
		//#region src/client/styles.ts
		const STYLE = `
.dsh-bio-center,.dsh-bio-center *{box-sizing:border-box}
.dsh-bio-center[hidden]{display:none}
.dsh-bio-center{--bio-bg:var(--dsw-alias-bg-base,#111318);--bio-layer:var(--dsw-alias-bg-layer-1,#171a20);--bio-layer-2:var(--dsw-alias-bg-layer-2,#1d2027);--bio-layer-3:var(--dsw-alias-bg-layer-3,#242832);--bio-text:var(--dsw-alias-label-primary,#f2f3f5);--bio-muted:var(--dsw-alias-label-secondary,#aeb4bf);--bio-subtle:var(--dsw-alias-label-tertiary,#858d9b);--bio-border:var(--dsw-alias-border-l1,rgba(255,255,255,.11));--bio-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.18));--bio-primary:var(--dsw-alias-button-primary-fill,#5b5cf0);--bio-primary-hover:var(--dsw-alias-button-primary-hover,#6f70f5);--bio-primary-text:var(--dsw-alias-button-primary-foreground,#fff);--bio-hover:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));--bio-success:var(--dsw-alias-status-success,#42bf79);--bio-warning:var(--dsw-alias-status-warning,#e5ad3d);--bio-error:var(--dsw-alias-status-error,#ef6a72);position:absolute;inset:12px;z-index:80;display:flex;flex-direction:column;min-width:0;overflow:hidden;color:var(--bio-text);background:var(--bio-bg);border:1px solid var(--bio-border-2);border-radius:14px;box-shadow:0 18px 52px rgba(0,0,0,.34);font-family:var(--dsw-font-family,Inter,ui-sans-serif,system-ui,sans-serif);font-size:14px;line-height:1.45;animation:dsh-bio-open 260ms cubic-bezier(.16,1,.3,1)}
.dsh-bio-center ::selection,.dsh-bio-graph ::selection{background:color-mix(in srgb,var(--bio-primary,#5b5cf0) 42%,transparent);color:var(--bio-text,#f2f3f5)}
.dsh-bio-center ::-webkit-scrollbar,.dsh-bio-graph ::-webkit-scrollbar{width:10px;height:10px}.dsh-bio-center ::-webkit-scrollbar-track,.dsh-bio-graph ::-webkit-scrollbar-track{background:transparent}.dsh-bio-center ::-webkit-scrollbar-thumb,.dsh-bio-graph ::-webkit-scrollbar-thumb{background:var(--bio-border-2,rgba(255,255,255,.18));border:3px solid transparent;border-radius:8px;background-clip:padding-box}
@keyframes dsh-bio-open{from{transform:translateY(8px);clip-path:inset(0 0 3% 0);opacity:.96}to{transform:translateY(0);clip-path:inset(0);opacity:1}}
.dsh-bio-center button,.dsh-bio-center input,.dsh-bio-center textarea{font:inherit}.dsh-bio-center button{color:inherit}.dsh-bio-center button:focus-visible,.dsh-bio-center input:focus-visible,.dsh-bio-center textarea:focus-visible,.dsh-bio-graph [tabindex]:focus-visible{outline:2px solid color-mix(in srgb,var(--bio-primary,#5b5cf0) 78%,white);outline-offset:2px}
.dsh-bio-center__header{height:62px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 18px 0 20px;border-bottom:1px solid var(--bio-border);background:var(--bio-layer)}
.dsh-bio-center__identity,.dsh-bio-center__header-meta,.dsh-bio-inspector__title,.dsh-bio-section-title{display:flex;align-items:center}.dsh-bio-center__identity{gap:12px}.dsh-bio-center__identity>svg{width:22px;height:22px;color:color-mix(in srgb,var(--bio-primary) 78%,white)}.dsh-bio-center h1,.dsh-bio-center h2,.dsh-bio-center h3,.dsh-bio-center p{margin:0}.dsh-bio-center h1{font-size:15px;font-weight:680;letter-spacing:-.01em}.dsh-bio-center__identity p{font-size:12px;color:var(--bio-subtle);margin-top:1px}.dsh-bio-center__header-meta{gap:10px}
.dsh-bio-icon-button{width:36px;height:36px;display:grid;place-items:center;border:1px solid transparent;border-radius:8px;background:transparent;cursor:pointer}.dsh-bio-icon-button:hover{background:var(--bio-hover);border-color:var(--bio-border)}
.dsh-bio-center__body{flex:1;min-height:0;display:grid;grid-template-columns:168px minmax(0,1fr)}
.dsh-bio-nav{min-width:0;padding:14px 10px;display:flex;flex-direction:column;gap:4px;background:var(--bio-layer);border-right:1px solid var(--bio-border)}.dsh-bio-nav>button{height:40px;display:flex;align-items:center;gap:10px;padding:0 11px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--bio-muted);cursor:pointer;text-align:left}.dsh-bio-nav>button:hover{background:var(--bio-hover);color:var(--bio-text)}.dsh-bio-nav>button[data-active]{background:color-mix(in srgb,var(--bio-primary) 15%,var(--bio-layer));border-color:color-mix(in srgb,var(--bio-primary) 28%,var(--bio-border));color:var(--bio-text)}.dsh-bio-nav>button[data-active] svg{color:color-mix(in srgb,var(--bio-primary) 72%,white)}.dsh-bio-nav__foot{margin-top:auto;padding:14px 10px 6px;border-top:1px solid var(--bio-border);display:flex;flex-direction:column}.dsh-bio-nav__foot span,.dsh-bio-nav__foot small{font-size:11px;color:var(--bio-subtle)}.dsh-bio-nav__foot strong{font-size:12px;margin:3px 0}
.dsh-bio-content{min-width:0;min-height:0;position:relative;overflow:auto;background:var(--bio-bg)}.dsh-bio-area{min-height:100%;display:grid}.dsh-bio-area--workflows{grid-template-columns:minmax(520px,1fr) 300px}.dsh-bio-area--single{padding:24px;display:block}.dsh-bio-main-pane,.dsh-bio-workbench{min-width:0;padding:24px}.dsh-bio-main-pane{border-right:1px solid var(--bio-border)}
.dsh-bio-area-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.dsh-bio-area-heading h2{font-size:21px;font-weight:680;letter-spacing:-.025em}.dsh-bio-area-heading p{max-width:68ch;margin-top:5px;color:var(--bio-muted);font-size:13px}.dsh-bio-count,.dsh-bio-version{font-variant-numeric:tabular-nums;color:var(--bio-subtle);font-size:12px;padding-top:5px}
.dsh-bio-search{height:40px;display:flex;align-items:center;gap:9px;padding:0 12px;margin-bottom:12px;border:1px solid var(--bio-border);border-radius:8px;background:var(--bio-layer)}.dsh-bio-search:focus-within{border-color:color-mix(in srgb,var(--bio-primary) 70%,var(--bio-border))}.dsh-bio-search svg{width:16px;color:var(--bio-subtle)}.dsh-bio-search input{width:100%;height:100%;border:0;outline:0;color:var(--bio-text);background:transparent}.dsh-bio-search input::placeholder,.dsh-bio-field input::placeholder,.dsh-bio-field textarea::placeholder{color:var(--bio-subtle);opacity:1}
.dsh-bio-workflow-table{border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-workflow-table__head,.dsh-bio-workflow-table__body>button{display:grid;grid-template-columns:minmax(230px,1fr) 88px 58px 88px;align-items:center;gap:12px}.dsh-bio-workflow-table__head{height:34px;padding:0 12px;color:var(--bio-subtle);font-size:11px;text-transform:uppercase;letter-spacing:.055em}.dsh-bio-workflow-table__body>button{width:100%;min-height:58px;padding:9px 12px;border:0;border-top:1px solid var(--bio-border);background:transparent;text-align:left;cursor:pointer}.dsh-bio-workflow-table__body>button:hover{background:var(--bio-hover)}.dsh-bio-workflow-table__body>button[data-selected]{background:color-mix(in srgb,var(--bio-primary) 11%,var(--bio-layer));box-shadow:inset 2px 0 0 var(--bio-primary)}.dsh-bio-workflow-name{display:flex;min-width:0;flex-direction:column}.dsh-bio-workflow-name strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:610}.dsh-bio-workflow-name small{margin-top:2px;color:var(--bio-subtle);font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}.dsh-bio-source{color:var(--bio-muted);text-transform:capitalize}.dsh-bio-status,.dsh-bio-badge{display:inline-flex;align-items:center;justify-content:center;width:max-content;border:1px solid var(--bio-border);border-radius:999px;line-height:22px;padding:0 8px;font-size:11px;white-space:nowrap}.dsh-bio-status--success,.dsh-bio-badge--success{color:color-mix(in srgb,var(--bio-success) 78%,var(--bio-text));border-color:color-mix(in srgb,var(--bio-success) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-success) 9%,transparent)}.dsh-bio-status--warning,.dsh-bio-badge--warning{color:color-mix(in srgb,var(--bio-warning) 78%,var(--bio-text));border-color:color-mix(in srgb,var(--bio-warning) 34%,var(--bio-border));background:color-mix(in srgb,var(--bio-warning) 9%,transparent)}.dsh-bio-status--neutral{color:var(--bio-muted)}
.dsh-bio-inspector{min-width:0;padding:24px 20px;background:var(--bio-layer)}.dsh-bio-inspector__title{gap:10px}.dsh-bio-inspector__title>svg,.dsh-bio-section-title>svg{flex:none;color:color-mix(in srgb,var(--bio-primary) 68%,white)}.dsh-bio-inspector__title h3{font-size:16px}.dsh-bio-inspector__title p{font-size:11px;color:var(--bio-subtle);font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dsh-bio-summary{margin:18px 0 20px!important;color:var(--bio-muted);line-height:1.6}.dsh-bio-facts{margin:0;border-top:1px solid var(--bio-border)}.dsh-bio-facts>div{display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--bio-border)}.dsh-bio-facts dt{color:var(--bio-subtle)}.dsh-bio-facts dd{margin:0;text-align:right;color:var(--bio-muted)}.dsh-bio-facts code,.dsh-bio-run-plan code,.dsh-bio-graph code{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px}.dsh-bio-tags{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}.dsh-bio-tags span{padding:3px 7px;border:1px solid var(--bio-border);border-radius:5px;color:var(--bio-muted);font-size:11px}.dsh-bio-lane{position:relative;display:flex;justify-content:space-between;gap:4px;margin:24px 0 20px;padding-top:16px;border-top:1px solid var(--bio-border)}.dsh-bio-lane span{position:relative;color:var(--bio-subtle);font-size:10px}.dsh-bio-lane span:before{content:"";position:absolute;top:-20px;left:50%;width:7px;height:7px;border-radius:50%;background:var(--bio-layer-3);border:1px solid var(--bio-border-2);transform:translateX(-50%)}.dsh-bio-lane span[data-active]:before{background:var(--bio-primary);border-color:var(--bio-primary)}
.dsh-bio-actions{display:flex;flex-direction:column;gap:8px}.dsh-bio-actions--inline{flex-direction:row;flex-wrap:wrap}.dsh-bio-button{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:7px 12px;border:1px solid var(--bio-primary);border-radius:8px;background:var(--bio-primary);color:var(--bio-primary-text)!important;font-weight:620;cursor:pointer}.dsh-bio-button:hover:not(:disabled){background:var(--bio-primary-hover)}.dsh-bio-button:disabled{cursor:not-allowed;opacity:.46}.dsh-bio-button svg{width:15px;height:15px}.dsh-bio-button--secondary{border-color:var(--bio-border-2);background:transparent;color:var(--bio-text)!important}.dsh-bio-button--secondary:hover:not(:disabled){background:var(--bio-hover)}
.dsh-bio-workbench{max-width:1120px;margin:0 auto}.dsh-bio-workbench__split{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-workbench__split>form,.dsh-bio-run-plan{padding:22px 22px 24px}.dsh-bio-workbench__split>form+form,.dsh-bio-run-plan{border-left:1px solid var(--bio-border)}.dsh-bio-section-title{gap:10px;margin-bottom:20px}.dsh-bio-section-title h3{font-size:15px}.dsh-bio-section-title p{margin-top:3px;color:var(--bio-subtle);font-size:12px}.dsh-bio-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px}.dsh-bio-field>span{color:var(--bio-muted);font-size:12px;font-weight:590}.dsh-bio-field input,.dsh-bio-field textarea{width:100%;border:1px solid var(--bio-border);border-radius:7px;background:var(--bio-layer);color:var(--bio-text);padding:9px 10px;outline:0}.dsh-bio-field input{height:40px}.dsh-bio-field textarea{resize:vertical;min-height:94px}.dsh-bio-field input:focus,.dsh-bio-field textarea:focus{border-color:color-mix(in srgb,var(--bio-primary) 70%,var(--bio-border))}.dsh-bio-trust-note{display:flex;gap:12px;margin-top:18px;padding:14px;border:1px solid color-mix(in srgb,var(--bio-warning) 26%,var(--bio-border));border-radius:8px;background:color-mix(in srgb,var(--bio-warning) 7%,var(--bio-layer))}.dsh-bio-trust-note>svg{flex:none;color:var(--bio-warning)}.dsh-bio-trust-note p{margin-top:3px;color:color-mix(in srgb,var(--bio-warning) 45%,var(--bio-muted));font-size:12px}
.dsh-bio-run-strip{display:grid;grid-template-columns:repeat(4,1fr);margin:10px 0 22px;border-top:1px solid var(--bio-border);border-bottom:1px solid var(--bio-border)}.dsh-bio-run-strip>div{position:relative;display:grid;grid-template-columns:24px 1fr;column-gap:9px;padding:15px}.dsh-bio-run-strip>div+div{border-left:1px solid var(--bio-border)}.dsh-bio-run-strip span{grid-row:1/3;width:22px;height:22px;display:grid;place-items:center;border:1px solid var(--bio-border-2);border-radius:50%;font-size:10px;font-variant-numeric:tabular-nums}.dsh-bio-run-strip strong{font-size:12px}.dsh-bio-run-strip small{color:var(--bio-subtle);font-size:10px}.dsh-bio-run-plan{display:flex;flex-direction:column;align-items:flex-start}.dsh-bio-run-plan>p{margin:4px 0;color:var(--bio-muted)}.dsh-bio-run-plan>code{margin:10px 0 20px;color:var(--bio-subtle)}.dsh-bio-run-plan>.dsh-bio-button{margin-top:auto}
.dsh-bio-readiness{border-top:1px solid var(--bio-border)}.dsh-bio-readiness>div{display:grid;grid-template-columns:36px minmax(0,1fr) auto;align-items:center;gap:12px;min-height:64px;padding:9px 4px;border-bottom:1px solid var(--bio-border)}.dsh-bio-readiness__icon{width:28px;height:28px;display:grid;place-items:center;border:1px solid var(--bio-border);border-radius:7px}.dsh-bio-readiness__icon svg{width:15px}.dsh-bio-readiness__icon--ready{color:var(--bio-success);background:color-mix(in srgb,var(--bio-success) 8%,transparent)}.dsh-bio-readiness__icon--off{color:var(--bio-subtle)}.dsh-bio-readiness p{margin-top:2px;color:var(--bio-subtle);font-size:12px}.dsh-bio-setup-footer{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:20px 4px}.dsh-bio-setup-footer p{margin-top:3px;color:var(--bio-muted)}
.dsh-bio-banner{display:flex;align-items:center;gap:9px;margin:14px 18px 0;padding:10px 12px;border:1px solid color-mix(in srgb,var(--bio-success) 28%,var(--bio-border));border-radius:8px;background:color-mix(in srgb,var(--bio-success) 7%,var(--bio-layer));color:color-mix(in srgb,var(--bio-success) 42%,var(--bio-text));font-size:12px}.dsh-bio-banner svg{width:16px}.dsh-bio-banner--error{border-color:color-mix(in srgb,var(--bio-error) 30%,var(--bio-border));background:color-mix(in srgb,var(--bio-error) 7%,var(--bio-layer));color:color-mix(in srgb,var(--bio-error) 38%,var(--bio-text))}.dsh-bio-banner button{margin-left:auto;border:0;background:transparent;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.dsh-bio-loading,.dsh-bio-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--bio-muted)}.dsh-bio-loading{min-height:360px}.dsh-bio-loading p,.dsh-bio-empty span{margin-top:5px;color:var(--bio-subtle);font-size:12px}.dsh-bio-empty{min-height:160px;padding:24px}.dsh-bio-empty>svg{margin-bottom:10px;color:var(--bio-subtle)}.dsh-bio-spinner{width:18px;height:18px;margin-bottom:12px;border:2px solid var(--bio-border-2);border-top-color:var(--bio-primary);border-radius:50%;animation:dsh-bio-spin .8s linear infinite}@keyframes dsh-bio-spin{to{transform:rotate(360deg)}}
.dsh-bio-sidebar-action{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:0 0 calc(100% + 8px);width:calc(100% + 8px);height:34px;margin:4px -4px;padding:6px 2px 6px 10px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);cursor:pointer;overflow:hidden}.dsh-bio-sidebar-action:hover,.dsh-bio-sidebar-action[data-open]{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}.dsh-bio-sidebar-action span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dsh-bio-sidebar-action[data-rail]{flex:0 0 36px;justify-content:center;gap:0;width:36px;height:36px;margin:4px 0;padding:0;border-radius:50%}:has(>.dsh-bio-sidebar-action),:has(>*>.dsh-bio-sidebar-action){flex-wrap:wrap}
.dsh-bio-graph{--bio-text:var(--dsw-alias-label-primary,#f2f3f5);--bio-muted:var(--dsw-alias-label-secondary,#aeb4bf);--bio-subtle:var(--dsw-alias-label-tertiary,#858d9b);--bio-layer:var(--dsw-alias-bg-layer-1,#171a20);--bio-layer-2:var(--dsw-alias-bg-layer-2,#1d2027);--bio-border:var(--dsw-alias-border-l1,rgba(255,255,255,.11));--bio-border-2:var(--dsw-alias-border-l2,rgba(255,255,255,.18));--bio-primary:var(--dsw-alias-button-primary-fill,#5b5cf0);--bio-success:var(--dsw-alias-status-success,#42bf79);--bio-warning:var(--dsw-alias-status-warning,#e5ad3d);color:var(--bio-text);border:1px solid var(--bio-border);border-radius:9px;overflow:hidden;background:var(--bio-layer);font-family:var(--dsw-font-family,Inter,ui-sans-serif,system-ui,sans-serif)}.dsh-bio-graph__bar,.dsh-bio-graph__footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px}.dsh-bio-graph__bar{border-bottom:1px solid var(--bio-border)}.dsh-bio-graph__bar>div{display:flex;min-width:0;flex-direction:column}.dsh-bio-graph__bar strong{font-size:13px}.dsh-bio-graph__bar span:not(.dsh-bio-badge){color:var(--bio-subtle);font-size:11px}.dsh-bio-graph__viewport{overflow:auto;min-height:220px;max-height:440px;background-color:var(--dsw-alias-bg-base,#111318);background-image:radial-gradient(circle,var(--bio-border) .7px,transparent .8px);background-size:16px 16px}.dsh-bio-graph svg{display:block;min-width:720px;width:100%;height:auto}.dsh-bio-graph__edge{fill:none;stroke:color-mix(in srgb,var(--bio-subtle) 70%,transparent);stroke-width:1.4}.dsh-bio-graph__edge[data-kind=control]{stroke-dasharray:5 4}.dsh-bio-graph__arrow{fill:var(--bio-subtle)}.dsh-bio-graph__node{cursor:pointer}.dsh-bio-graph__node rect{fill:var(--bio-layer-2);stroke:var(--bio-border-2);stroke-width:1}.dsh-bio-graph__node:hover rect,.dsh-bio-graph__node[data-selected] rect{stroke:var(--bio-primary);stroke-width:1.7}.dsh-bio-graph__node[data-kind=workflow-input] rect,.dsh-bio-graph__node[data-kind=workflow-output] rect{fill:color-mix(in srgb,#3d8bfd 9%,var(--bio-layer-2));stroke:color-mix(in srgb,#3d8bfd 52%,var(--bio-border))}.dsh-bio-graph__node[data-kind=call] rect{fill:color-mix(in srgb,var(--bio-primary) 10%,var(--bio-layer-2));stroke:color-mix(in srgb,var(--bio-primary) 50%,var(--bio-border))}.dsh-bio-graph__node[data-kind=scatter] rect,.dsh-bio-graph__node[data-kind=conditional] rect{fill:color-mix(in srgb,var(--bio-warning) 9%,var(--bio-layer-2));stroke:color-mix(in srgb,var(--bio-warning) 52%,var(--bio-border))}.dsh-bio-graph__kind{fill:var(--bio-subtle);font-size:9px;font-family:var(--dsw-font-mono,ui-monospace,monospace);letter-spacing:.08em}.dsh-bio-graph__label{fill:var(--bio-text);font-size:13px;font-weight:600}.dsh-bio-graph__ports{fill:var(--bio-subtle);font-size:9px}.dsh-bio-graph__footer{border-top:1px solid var(--bio-border);color:var(--bio-subtle);font-size:11px}.dsh-bio-graph__selection{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;align-items:center;gap:14px;padding:10px 12px;border-top:1px solid var(--bio-border);font-size:11px}.dsh-bio-graph__selection>div{display:flex;flex-direction:column}.dsh-bio-graph__selection>div span,.dsh-bio-graph__selection p{color:var(--bio-subtle)}.dsh-bio-graph__selection p{margin:0}.dsh-bio-graph__selection button{border:1px solid var(--bio-border);border-radius:6px;background:transparent;color:var(--bio-muted);padding:5px 8px;cursor:pointer}.dsh-bio-graph__diagnostics{list-style:none;margin:0;padding:0;border-top:1px solid var(--bio-border)}.dsh-bio-graph__diagnostics li{display:flex;gap:9px;padding:9px 12px;color:var(--bio-muted);font-size:11px}.dsh-bio-graph__diagnostics li+li{border-top:1px solid var(--bio-border)}.dsh-bio-graph__diagnostics strong{color:var(--bio-warning);font-family:var(--dsw-font-mono,ui-monospace,monospace)}.dsh-bio-tool-state{display:flex;align-items:center;gap:9px;padding:14px;color:var(--dsw-alias-label-secondary,#aeb4bf);font-size:12px}.dsh-bio-tool-state .dsh-bio-spinner{margin:0}.dsh-bio-tool-state--error{color:var(--dsw-alias-status-error,#ef6a72)}
@media(max-width:980px){.dsh-bio-area--workflows{grid-template-columns:1fr}.dsh-bio-main-pane{border-right:0}.dsh-bio-inspector{border-top:1px solid var(--bio-border)}.dsh-bio-workflow-table__head,.dsh-bio-workflow-table__body>button{grid-template-columns:minmax(210px,1fr) 80px 54px 80px}}
.dsh-bio-graph__viewport{background-image:none;background-color:var(--dsw-alias-bg-base,#111318)}
@media(max-width:760px){.dsh-bio-center{inset:0;border:0;border-radius:0}.dsh-bio-center__header{height:58px;padding:0 12px}.dsh-bio-center__identity p,.dsh-bio-center__header-meta>.dsh-bio-badge{display:none}.dsh-bio-center__body{display:flex;flex-direction:column}.dsh-bio-nav{flex:none;flex-direction:row;overflow:auto;padding:7px;border-right:0;border-bottom:1px solid var(--bio-border)}.dsh-bio-nav>button{min-width:max-content;height:38px}.dsh-bio-nav__foot{display:none}.dsh-bio-content{flex:1}.dsh-bio-main-pane,.dsh-bio-workbench,.dsh-bio-inspector{padding:18px 14px}.dsh-bio-area--single{padding:0}.dsh-bio-workbench__split{grid-template-columns:1fr}.dsh-bio-workbench__split>form+form,.dsh-bio-run-plan{border-left:0;border-top:1px solid var(--bio-border)}.dsh-bio-workbench__split>form,.dsh-bio-run-plan{padding:18px 4px}.dsh-bio-run-strip{grid-template-columns:1fr 1fr}.dsh-bio-run-strip>div:nth-child(3){border-left:0;border-top:1px solid var(--bio-border)}.dsh-bio-run-strip>div:nth-child(4){border-top:1px solid var(--bio-border)}.dsh-bio-workflow-table__head{display:none}.dsh-bio-workflow-table__body>button{grid-template-columns:1fr auto;gap:6px}.dsh-bio-workflow-table__body>button>span:nth-child(3){display:none}.dsh-bio-workflow-table__body>button>span:nth-child(4){grid-column:2}.dsh-bio-setup-footer{align-items:flex-start;flex-direction:column}.dsh-bio-graph__selection{grid-template-columns:1fr auto}.dsh-bio-graph__selection>p{display:none}}
@media(max-width:760px){.dsh-bio-nav>button{gap:6px;padding:0 7px;font-size:12px}}
@media(prefers-reduced-motion:reduce){.dsh-bio-center{animation:none}.dsh-bio-spinner{animation-duration:1.8s}}
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
		}
		//#endregion
		exports.DraftGraphToolView = DraftGraphToolView;
		exports.WorkflowCenter = WorkflowCenter;
		exports.WorkflowGraphView = WorkflowGraphView;
		exports.apply = apply;
		exports.inject = inject;
		exports.layoutWorkflowGraph = layoutWorkflowGraph;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map