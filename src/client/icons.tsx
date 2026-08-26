import type { SVGProps } from 'react'

function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.45"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  )
}

export function WorkflowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="2.25" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="11.25" y="10.5" width="4.5" height="4.5" rx="1" />
      <path d="M6.75 5.25h2.1a2.4 2.4 0 0 1 2.4 2.4v2.85" />
      <path d="m8.95 8.55 2.3 1.95 2.3-1.95" />
    </IconBase>
  )
}

export function DraftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M4 2.5h6.4l3.6 3.6v9.4H4z" />
      <path d="M10.4 2.5v3.6H14M6.5 9h5M6.5 12h3.5" />
    </IconBase>
  )
}

export function RunsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 5.6v3.8l2.6 1.6M3.25 4.2l1.45 1.4" />
    </IconBase>
  )
}

export function SetupIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M7.7 2.3h2.6l.45 1.75 1.55.9 1.75-.5 1.3 2.25-1.3 1.25v1.8l1.3 1.25-1.3 2.25-1.75-.5-1.55.9-.45 1.75H7.7l-.45-1.75-1.55-.9-1.75.5-1.3-2.25 1.3-1.25v-1.8L2.65 6.7l1.3-2.25 1.75.5 1.55-.9z" />
      <circle cx="9" cy="8.85" r="2.15" />
    </IconBase>
  )
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="m4.5 4.5 9 9m0-9-9 9" /></IconBase>
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="7.75" cy="7.75" r="4.75" />
      <path d="m11.2 11.2 3.6 3.6" />
    </IconBase>
  )
}

export function ArrowIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="M3 9h11.5m-4-4 4 4-4 4" /></IconBase>
}

export function RefreshIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M14.5 6.5A6 6 0 1 0 15 11" />
      <path d="M14.5 3v3.5H11" />
    </IconBase>
  )
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return <IconBase {...props}><path d="m3.5 9.2 3.2 3.2 7.8-7.8" /></IconBase>
}

export function WarningIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <path d="M8 2.8 1.9 14h14.2L10 2.8a1.15 1.15 0 0 0-2 0Z" />
      <path d="M9 6.4v3.5m0 2.15v.05" />
    </IconBase>
  )
}
