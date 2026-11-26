// How long the rider has been online, and where they stand against the shift
// rule today. Time counts only while their phone keeps reporting.

import type { ReactElement } from 'react'
import { formatDay, formatMoney, plural } from '../lib/format'
import type { LoginHours as Hours } from '../lib/types'
import { Badge, Card, Details } from './ui'

export const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`

export function LoginHours({ hours }: { hours: Hours }) {
  const { today } = hours

  return (
    <Card title="Login hours">
      <Details
        rows={[
          ...today.shifts.map((shift): [string, ReactElement] => [
            `${shift.name} today (${shift.start}–${shift.end})`,
            <span key={shift.name}>
              {duration(shift.doneMinutes)} of {duration(shift.minMinutes)} {shift.met && <Badge tone="success">Met</Badge>}
            </span>,
          ]),
          ['Orders turned down today', `${today.rejections} (up to ${today.maxRejections} allowed)`],
          ...hours.days.map((day): [string, string] => [formatDay(day.date), `${duration(day.onlineMinutes)} online`]),
        ]}
      />
      <p className="muted small">
        {hours.ruleOn
          ? 'The shift rule is on: the per-order incentive is paid after the day ends to riders who meet every shift.'
          : 'The shift rule is off (see Settings), so these hours do not change pay.'}
      </p>
      {hours.results.map((result) => (
        <p key={result.date} className="small">
          {formatDay(result.date)}:{' '}
          {result.eligible
            ? `${formatMoney(result.amountPaise)} incentive for ${plural(result.trips, 'order')}`
            : `shift rule not met, no incentive for ${plural(result.trips, 'order')}`}
        </p>
      ))}
    </Card>
  )
}
