import { useEffect, useState } from 'react'

interface Greeting {
  dateLabel: string
  greeting: string
}

const MORNING_ENDS_AT_HOUR = 12
const AFTERNOON_ENDS_AT_HOUR = 18

function timeOfDayGreeting(hour: number): string {
  if (hour < MORNING_ENDS_AT_HOUR) return 'Good morning'
  if (hour < AFTERNOON_ENDS_AT_HOUR) return 'Good afternoon'
  return 'Good evening'
}

export function useGreeting(name: string): Greeting {
  const [greeting, setGreeting] = useState<Greeting>({ dateLabel: '', greeting: `Hello, ${name}.` })

  useEffect(() => {
    const now = new Date()
    const dateLabel = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(now)
    setGreeting({ dateLabel, greeting: `${timeOfDayGreeting(now.getHours())}, ${name}.` })
  }, [name])

  return greeting
}
