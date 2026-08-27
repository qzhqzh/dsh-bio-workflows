import { expect, test } from '@playwright/test'

test('Workflow Center renders catalog and submits draft intent through the Agent bridge', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Workflow catalog' })).toBeVisible()
  await expect(page.getByText('Agent connected')).toBeVisible()
  await expect(page.getByRole('row', { name: /FASTQ quality control/ }).first()).toBeVisible()
  await page.screenshot({ path: '.impeccable/review/workflow-center-desktop.png', fullPage: true })

  await page.getByRole('button', { name: 'AI Drafts' }).click()
  await page.getByLabel('Workflow id').fill('rna-seq-qc')
  await page.getByLabel('Name').fill('RNA sequencing QC')
  await page.getByLabel('Purpose').fill('Quality control for paired-end RNA sequencing reads.')
  await page.getByRole('button', { name: /Create with Agent/ }).click()
  await expect.poll(() => page.evaluate(() => window.__BIO_PREVIEW__.lastPrompt)).toContain('bio_workflows_draft_create')
  expect(errors).toEqual([])
})

test('Workflow Center adapts to a narrow viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Workflow catalog' })).toBeVisible()
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

test('Workflow Center fails closed when no Harness task is current', async ({ page }) => {
  await page.goto('/?session=none')

  await expect(page.getByText('Open a Harness task')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask Agent to validate/ })).toBeDisabled()
  await page.getByRole('button', { name: 'AI Drafts' }).click()
  await expect(page.getByRole('button', { name: /Create with Agent/ })).toBeDisabled()
})

test('Workflow Center presents an Agent rejection as an error with recovery context', async ({ page }) => {
  await page.goto('/?prompt=reject')
  await page.getByRole('button', { name: 'AI Drafts' }).click()
  await page.getByLabel('Workflow id').fill('rna-seq-qc')
  await page.getByLabel('Name').fill('RNA sequencing QC')
  await page.getByLabel('Purpose').fill('Quality control for paired-end RNA sequencing reads.')
  await page.getByRole('button', { name: /Create with Agent/ }).click()

  await expect(page.getByRole('alert')).toContainText('policy_denied: Agent request rejected.')
  await expect(page.getByRole('dialog', { name: 'Bio Workflows' })).toBeVisible()
})

test('Workflow Center exposes catalog diagnostics and disabled draft writes', async ({ page }) => {
  await page.goto('/?writes=off&catalog=warning')

  await expect(page.getByRole('alert')).toContainText('configured local workflow store is unavailable')
  await page.getByRole('button', { name: 'Setup' }).click()
  const draftWrites = page.locator('.dsh-bio-readiness > div').filter({ hasText: 'Draft writes' })
  await expect(draftWrites).toContainText('Off')
  await page.getByRole('button', { name: 'AI Drafts' }).click()
  await expect(page.getByText('Writes off')).toBeVisible()
  await page.getByLabel('Workflow id').fill('rna-seq-qc')
  await page.getByLabel('Name').fill('RNA sequencing QC')
  await page.getByLabel('Purpose').fill('Quality control for paired-end RNA sequencing reads.')
  await expect(page.getByRole('button', { name: /Create with Agent/ })).toBeDisabled()
})

test('Workflow Center submits isolated draft-test intent only through the Agent bridge', async ({ page }) => {
  await page.goto('/?isolated=on')
  await page.getByRole('button', { name: 'AI Drafts' }).click()
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

  await expect(page.getByText('Execution', { exact: true })).toBeVisible()
  await expect(page.getByText('Allowlisted', { exact: true })).toBeVisible()
  await page.getByRole('row', { name: /BAM quality control/ }).click()
  await expect(page.getByText('Not execution-allowlisted')).toBeVisible()
  await expect(page.getByRole('button', { name: /Prepare a safe run/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Runs' }).click()
  await expect(page.getByRole('button', { name: 'Execution unavailable' })).toBeDisabled()
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
