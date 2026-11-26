"""Payouts: what Foodos owes restaurants and riders, and paying it on schedule.

settings.py   the payment settings the admin panel edits (cached in memory)
dates.py      business days, schedule periods and pay dates
ledger.py     the earnings ledger: one row per thing that changes what is owed
schedule.py   turning ledger rows into payouts, and what staff do with them
finance.py    the admin finance page: overview, lists, reports
party.py      what the restaurant and rider apps show
statements.py printable payout statements behind signed links
accounts.py   restaurant bank details
notify.py     push notifications about payouts
"""
