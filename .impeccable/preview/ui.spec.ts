import { expect, test, type Page } from '@playwright/test'

async function fillAnalysisBrief(page: Page) {
  await page.getByLabel('Biological question').fill('Are these paired-end RNA sequencing reads high quality enough for downstream expression analysis?')
  await page.getByLabel('Input data and types').fill('Paired-end FASTQ files under /data/rna-seq, grouped by sample.')
  await page.getByLabel('Desired outputs').fill('Per-sample HTML reports and machine-readable quality summaries.')
  await page.getByLabel('Constraints (optional)').fill('Use pinned containers and do not modify the input files.')
  await page.getByLabel('Acceptance criteria').fill('Every input has a checksummed report and all failed checks are explained.')
}

function contrastRatio(foreground: string, background: string) {
  const channels = (value: string) => {
    const match = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)/)
    if (match === null) throw new Error(`Unsupported computed color: ${value}`)
    return match.slice(1, 4).map((channel) => {
      const normalized = Number(channel) / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
  }
  const luminance = (value: string) => {
    const [red, green, blue] = channels(value)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

test('Workflow Center renders catalog and submits draft intent through the Agent bridge', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Analyze data' })).toBeVisible()
  await expect(page.getByText('Agent connected')).toBeVisible()
  await expect(page.getByRole('row', { name: /FASTQ quality control/ }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Scientific fit' })).toBeVisible()
  await expect(page.getByText('Accepted inputs', { exact: true })).toBeVisible()
  await expect(page.getByText('summary_reports', { exact: true })).toBeVisible()
  await expect(page.getByText('Execution eligible', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Technical details', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Selected workflow details').getByText('Execution', { exact: true })).toBeHidden()
  await page.screenshot({ path: '.impeccable/review/workflow-center-desktop.png', fullPage: true })

  await page.getByRole('button', { name: 'Build workflow' }).click()
  await expect(page.getByLabel('Draft id')).toBeHidden()
  await fillAnalysisBrief(page)
  await page.getByRole('button', { name: /Build workflow draft/ }).click()
  await expect.poll(() => page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)).toContain('bio_workflows_draft_create')
  await expect.poll(() => page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)).toContain('Paired-end FASTQ files under /data/rna-seq')
  await expect.poll(() => page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)).toContain('Do not plan, execute, install, promote, or allowlist it')
  expect(errors).toEqual([])
})

test('Workflow Center explains package checks and keeps the Agent handoff visible', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByText(/Checks descriptor shape, SHA-256 file digests/)).toBeVisible()
  await expect(page.getByText(/It does not run an engine/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Prepare analysis/ })).toBeVisible()
  await page.getByRole('button', { name: /Check workflow package/ }).click()

  const prompt = await page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)
  expect(prompt).toContain('bio_workflows_validate')
  expect(prompt).toContain('read-only package check')
  expect(prompt).toContain('Do not call planning or execution tools')

  const handoff = page.getByRole('status')
  await expect(handoff).toContainText('Workflow package check')
  await expect(handoff).toContainText('FASTQ quality control · fastq-qc@1.2.0')
  await expect(handoff).toContainText('Queued')
  await page.waitForTimeout(500)
  await expect(page.getByRole('dialog', { name: 'Bio Workflows' })).toBeVisible()
  expect(await page.evaluate(() => window.__BIO_PREVIEW__.closeCount)).toBe(0)

  await page.getByRole('button', { name: 'Continue in Agent task' }).click()
  await expect(page.getByRole('dialog', { name: 'Bio Workflows' })).toBeHidden()
  expect(await page.evaluate(() => window.__BIO_PREVIEW__.closeCount)).toBe(1)
  await page.getByRole('button', { name: 'Open preview center' }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('Workflow Center keeps an opaque outer surface when the host base token is transparent', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    document.body.style.setProperty('--dsw-alias-bg-base', 'transparent')
    document.body.style.background = 'rgb(255, 0, 255)'
  })

  const backgrounds = await page.getByRole('dialog', { name: 'Bio Workflows' }).evaluate((element) => ({
    outer: getComputedStyle(element).backgroundColor,
    hostTint: getComputedStyle(element, '::before').backgroundColor,
  }))
  expect(backgrounds.hostTint).toBe('rgba(0, 0, 0, 0)')
  expect(backgrounds.outer).not.toBe('rgba(0, 0, 0, 0)')
  expect(backgrounds.outer).not.toBe('rgb(255, 0, 255)')
})

test('Workflow Center remains opaque and readable with representative light host tokens', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light'
    document.body.style.setProperty('--dsw-alias-bg-base', '#f7f8fa')
    document.body.style.setProperty('--dsw-alias-bg-layer-1', '#ffffff')
    document.body.style.setProperty('--dsw-alias-bg-layer-2', '#f1f3f6')
    document.body.style.setProperty('--dsw-alias-bg-layer-3', '#e5e7eb')
    document.body.style.setProperty('--dsw-alias-label-primary', '#111827')
    document.body.style.setProperty('--dsw-alias-label-secondary', '#374151')
    document.body.style.setProperty('--dsw-alias-label-tertiary', '#4b5563')
    document.body.style.setProperty('--dsw-alias-border-l1', 'rgba(17, 24, 39, .13)')
    document.body.style.setProperty('--dsw-alias-border-l2', 'rgba(17, 24, 39, .22)')
  })

  const colors = await page.locator('.dsh-bio-center__header').evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    foreground: getComputedStyle(element).color,
  }))
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5)
})

test('Workflow Center adapts to a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Analyze data' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await page.screenshot({ path: '.impeccable/review/workflow-center-mobile.png', fullPage: true })
})

test('Workflow Center traps focus, closes with Escape, and restores the launcher', async ({ page }) => {
  await page.goto('/')
  const dialog = page.getByRole('dialog', { name: 'Bio Workflows' })
  const close = page.getByRole('button', { name: 'Close Workflow Center' })
  const launcher = page.getByRole('button', { name: 'Open preview center' })

  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await page.evaluate(() => (
    document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true
  ))).toBe(true)
  await close.click()
  await expect(dialog).toBeHidden()
  await launcher.click()
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(launcher).toBeFocused()
})

test('Workflow Center keeps focus inside the dialog from a closed disclosure summary', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Build workflow' }).click()
  const advanced = page.locator('summary').filter({ hasText: 'Advanced: exact draft and test identities' })
  await advanced.focus()
  await expect(advanced).toBeFocused()

  await page.keyboard.press('Tab')

  expect(await page.evaluate(() => (
    document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true
  ))).toBe(true)
})

test('Workflow Center fails closed when no Harness task is current', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?session=none')

  await expect(page.getByText('Open a Harness task')).toBeVisible()
  await expect(page.getByRole('button', { name: /Check workflow package/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Build workflow' }).click()
  await expect(page.getByRole('button', { name: /Build workflow draft/ })).toBeDisabled()
})

test('Workflow Center presents an Agent rejection as an error with recovery context', async ({ page }) => {
  await page.goto('/?prompt=reject')
  await page.getByRole('button', { name: 'Build workflow' }).click()
  await fillAnalysisBrief(page)
  await page.getByRole('button', { name: /Build workflow draft/ }).click()

  await expect(page.getByRole('alert')).toContainText('policy_denied: Agent request rejected.')
  await expect(page.getByRole('dialog', { name: 'Bio Workflows' })).toBeVisible()
})

test('Workflow Center exposes catalog diagnostics and disabled draft writes', async ({ page }) => {
  await page.goto('/?writes=off&catalog=warning')

  await expect(page.getByRole('alert')).toContainText('configured local workflow store is unavailable')
  await page.getByRole('button', { name: 'Setup' }).click()
  await expect(page.getByText('Analysis execution is blocked')).toBeVisible()
  await expect(page.getByText('Workflow execution is disabled.')).toBeVisible()
  await expect(page.getByText('Operator details', { exact: true })).toBeVisible()
  const draftWrites = page.locator('.dsh-bio-readiness > div').filter({ hasText: 'Draft writes' })
  await expect(draftWrites).toBeHidden()
  await page.getByText('Operator details', { exact: true }).click()
  await expect(draftWrites).toContainText('Off')
  await page.getByRole('button', { name: 'Build workflow' }).click()
  await expect(page.getByText('Writes off')).toBeVisible()
  await expect(page.getByText('Workflow drafting is unavailable')).toBeVisible()
  await expect(page.getByText(/The browser cannot change this setting/)).toBeVisible()
  await fillAnalysisBrief(page)
  await expect(page.getByRole('button', { name: /Build workflow draft/ })).toBeDisabled()
})

test('Workflow Center bounds analysis briefs before creating an Agent prompt', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Build workflow' }).click()

  await expect(page.getByLabel('Biological question')).toHaveAttribute('maxlength', '2000')
  await expect(page.getByLabel('Input data and types')).toHaveAttribute('maxlength', '3000')
  await expect(page.getByLabel('Desired outputs')).toHaveAttribute('maxlength', '1500')
  await expect(page.getByLabel('Constraints (optional)')).toHaveAttribute('maxlength', '1500')
  await expect(page.getByLabel('Acceptance criteria')).toHaveAttribute('maxlength', '2000')

  await fillAnalysisBrief(page)
  await page.getByLabel('Biological question').evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(element, 'x'.repeat(2001))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await expect(page.getByRole('button', { name: /Build workflow draft/ })).toBeDisabled()
  expect(await page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)).toBe('')
})

test('Workflow Center distinguishes unavailable scientific fit and blocks preparation', async ({ page }) => {
  await page.goto('/?fit=unavailable')

  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Scientific-fit metadata could not be verified/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scientific fit unavailable' })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Check workflow package/ })).toBeEnabled()
  await expect(page.getByText('Not declared in the workflow manifest.')).toHaveCount(0)
})

test('Workflow Center rejects malformed bootstrap ports without rendering a broken catalog', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  for (const fit of ['malformed', 'missing']) {
    await page.goto(`/?fit=${fit}`)
    await expect(page.getByRole('alert')).toContainText('bootstrap returned an incompatible payload')
    await expect(page.getByRole('row', { name: /FASTQ quality control/ })).toHaveCount(0)
  }
  expect(errors).toEqual([])
})

test('Workflow Center submits isolated draft-test intent only through the Agent bridge', async ({ page }) => {
  await page.goto('/?isolated=on')
  await page.getByRole('button', { name: 'Build workflow' }).click()
  await page.getByText('Advanced: exact draft and test identities', { exact: true }).click()
  await page.getByLabel('Ready Mission id').fill('mission-11111111-1111-4111-8111-111111111111')
  await page.getByRole('button', { name: /Prepare with Agent/ }).click()

  const prompt = await page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)
  expect(prompt).toContain('bio_workflows_draft_test_prepare')
  expect(prompt).toContain('text-roundtrip@1.0.0')
  expect(prompt).toContain('Do not call bio_workflows_draft_test_start')
  expect(prompt).toContain('Never install, promote, allowlist, or production-run')
})

test('Workflow Center exposes the exact execution allowlist and blocks unsupported plans', async ({ page }) => {
  await page.goto('/')

  await page.getByText('Technical details', { exact: true }).click()
  await expect(page.getByLabel('Selected workflow details').getByText('Execution', { exact: true })).toBeVisible()
  await expect(page.getByText('Allowlisted', { exact: true })).toBeVisible()
  await page.getByRole('row', { name: /BAM quality control/ }).click()
  await expect(page.getByText('Not execution-allowlisted')).toBeVisible()
  await expect(page.getByRole('button', { name: /Analysis unavailable/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Activity' }).click()
  await expect(page.getByRole('button', { name: 'Analysis unavailable' })).toBeDisabled()
})

test('WorkflowGraph renders proven edges and exposes keyboard-selectable node details', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?view=graph')
  await expect(page.getByRole('img', { name: /WDL dependency graph/ })).toBeVisible()
  await expect(page.getByText('6 nodes · 6 edges')).toBeVisible()
  await page.getByRole('button', { name: 'CALL fastqc' }).click()
  await expect(page.getByText('Target fastqc_one')).toBeVisible()
  await page.screenshot({ path: '.impeccable/review/workflow-graph-card.png', fullPage: true })
})

test('WorkflowGraph rejects malformed replay payloads before layout or rendering', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/?view=graph-malformed')

  await expect(page.getByText('The tool returned an invalid WorkflowGraph v1 payload.')).toBeVisible()
  expect(errors).toEqual([])
})

test('Run result presents completion and QC findings before technical provenance', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 980, height: 900 })
  await page.goto('/?view=result')

  await expect(page.getByRole('heading', { name: 'Analysis completed' })).toBeVisible()
  await expect(page.getByText(/FastQC finished for 1 sample/)).toBeVisible()
  await expect(page.getByText('Passed', { exact: true })).toBeVisible()
  await expect(page.getByText('Warnings', { exact: true })).toBeVisible()
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Produced outputs' })).toBeVisible()
  await expect(page.getByText('HTML reports', { exact: true })).toBeVisible()
  await expect(page.getByText('3 files · 651 KB', { exact: true })).toBeVisible()
  await expect(page.getByText('run-11111111-1111-4111-8111-111111111111')).toBeHidden()
  await expect(page.getByText('/private/run', { exact: false })).toHaveCount(0)
  await page.getByText('Technical evidence', { exact: true }).click()
  await expect(page.getByText('run-11111111-1111-4111-8111-111111111111')).toBeVisible()
  await expect(page.getByText('Checksummed files', { exact: true })).toBeVisible()
  await expect(page.getByText('Absolute host paths', { exact: false })).toBeVisible()
  await page.screenshot({ path: '/tmp/dsh-bio-workflows-result-desktop.png', fullPage: true })
  expect(errors).toEqual([])
})

test('Run result keeps failures truthful and offers no direct retry control', async ({ page }) => {
  await page.goto('/?view=result-failed')

  await expect(page.getByRole('heading', { name: 'Analysis did not complete' })).toBeVisible()
  await expect(page.getByText(/workflow engine reported a failure/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Produced outputs' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /retry/i })).toHaveCount(0)
  await page.getByText('Technical evidence', { exact: true }).click()
  await expect(page.getByText('miniwdl_failed', { exact: true })).toBeVisible()
})

test('Run result fails closed on malformed normalized evidence without hiding durable status', async ({ page }) => {
  await page.goto('/?view=result-malformed')

  await expect(page.getByRole('heading', { name: 'Analysis completed' })).toBeVisible()
  await expect(page.getByText(/normalized result could not be safely verified/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Produced outputs' })).toHaveCount(0)
  await expect(page.getByText('../private/output.html', { exact: false })).toHaveCount(0)
})

test('Run history shows bounded outcomes and an honest empty state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?view=runs')

  await expect(page.getByText('Recent analyses', { exact: true })).toBeVisible()
  await expect(page.getByText('Completed; inspect for outputs and QC findings')).toBeVisible()
  await expect(page.getByText('Execution is still in progress')).toBeVisible()
  await expect(page.getByText('Interrupted; no automatic retry occurred')).toBeVisible()
  await expect(page.getByText(/cannot start or retry an analysis/)).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: '/tmp/dsh-bio-workflows-runs-mobile.png', fullPage: true })

  await page.goto('/?view=runs-empty')
  await expect(page.getByText('No workflow runs yet', { exact: true })).toBeVisible()
  await expect(page.getByText(/explicit approval/)).toBeVisible()
})
