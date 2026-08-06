import type { JSX } from 'react'

export function AmbientBackground(): JSX.Element {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="landing-bloom-top absolute left-1/2 top-[-9%] h-[380px] w-[min(960px,94vw)] -translate-x-1/2 rounded-full opacity-90 blur-[50px]" />
      <div className="landing-bloom-a absolute left-1/2 top-[-22%] h-[740px] w-[min(1180px,128vw)] rounded-full opacity-60 blur-[70px]" />
      <div className="landing-bloom-b absolute bottom-[8%] right-[-10%] h-[560px] w-[min(680px,80vw)] rounded-full opacity-35 blur-[70px]" />
      <div className="landing-grain absolute inset-0 opacity-[0.035] mix-blend-multiply" />
    </div>
  )
}
