#!/usr/bin/env python3
"""
Hyder Media — Stripe invoice generator (card-fee pass-through).

Creates a Stripe invoice that matches the legacy Hyder Media invoice format
(sequential invoice #, project name, hourly line items) with the card
processing cost passed through as a disclosed line item, grossed up so the
NET deposit equals the billed amount exactly.

Continuity with the pre-Stripe invoices (last paper invoice: #10, 04/30/26):
  - "Invoice #" and "Project" appear as custom fields on the Stripe invoice
  - Terms: due on receipt
  - No bank details (card payment via Stripe's hosted page; Amex accepted)

Usage:
  # July 2026 for Dunham (17.5 hrs @ $300, invoice #11, to Bill Baker):
  python3 scripts/hyder-invoice.py --hours 17.5 --rate 300 --number 11 \
      --project "July Hourly" \
      --desc "Consulting — Maps Initiative & Reporting (July 2026)" \
      --email bbaker@dunhamlaw.com

  # then, after reviewing the draft in the dashboard:
  python3 scripts/hyder-invoice.py --send-draft in_XXXX

Flags:
  --amount N        flat amount instead of --hours/--rate
  --customer cus_X  default: Dunham & Jones
  --send            finalize + email immediately (skips draft review)
"""

import argparse
import json
import re
import subprocess

CUSTOMER = 'cus_Uw5M9wF2y8gJVR'   # Dunham & Jones, Attorneys at Law
CARD_PCT = 0.029                   # Stripe card rate (Amex same on blended pricing)
CARD_FIXED = 0.30
INVOICING_PCT = 0.004              # Stripe Invoicing fee

FOOTER = ('Payment by credit card via the link above (American Express accepted). '
          'The card processing line reflects actual payment-processing costs passed '
          'through at cost, per client request. To pay by ACH or check at the services '
          'amount with no processing line, reply to this invoice.')


def stripe_key():
    for line in open('/Users/kennyhyder/Projects/hyder-media/sportsbookish/.env.local'):
        m = re.match(r'^STRIPE_SECRET_KEY=(.+)$', line.strip())
        if m:
            return m.group(1).strip('"')
    raise SystemExit('no live Stripe key found')


def stripe(method, path, key, params=None):
    cmd = ['curl', '-s', f'https://api.stripe.com/v1/{path}', '-u', f'{key}:']
    if method == 'POST':
        cmd += ['-X', 'POST']
        for k, v in (params or {}).items():
            cmd += ['--data-urlencode', f'{k}={v}']
    out = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
    if 'error' in out:
        raise SystemExit(f"Stripe error: {out['error']['message']}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hours', type=float)
    ap.add_argument('--rate', type=float, default=300)
    ap.add_argument('--amount', type=float, help='flat amount (overrides hours×rate)')
    ap.add_argument('--number', required=False, help='sequential invoice number (e.g. 11)')
    ap.add_argument('--project', default='Hourly')
    ap.add_argument('--desc', required=False, default=None)
    ap.add_argument('--email', help='set/update the customer billing email')
    ap.add_argument('--customer', default=CUSTOMER)
    ap.add_argument('--send', action='store_true', help='finalize + email immediately')
    ap.add_argument('--send-draft', help='finalize + send an existing draft (in_...)')
    args = ap.parse_args()

    key = stripe_key()

    if args.send_draft:
        inv = stripe('POST', f'invoices/{args.send_draft}/finalize', key)
        stripe('POST', f'invoices/{args.send_draft}/send', key)
        print(f'sent: {inv["id"]}  hosted: {inv.get("hosted_invoice_url")}')
        return

    if args.amount is None and args.hours is None:
        raise SystemExit('need --hours or --amount')
    net = round(args.amount if args.amount is not None else args.hours * args.rate, 2)
    total = round((net + CARD_FIXED) / (1 - CARD_PCT - INVOICING_PCT), 2)
    fee_line = round(total - net, 2)

    if args.email:
        stripe('POST', f'customers/{args.customer}', key, {'email': args.email})

    desc = args.desc or f'Consulting services'
    if args.hours is not None:
        desc = f'{desc} — {args.hours:g} hours @ ${args.rate:,.0f}/hr'

    inv_params = {
        'customer': args.customer,
        'collection_method': 'send_invoice',
        'days_until_due': '0',                       # terms: on receipt
        'footer': FOOTER,
        'metadata[client]': 'dunham',
        'custom_fields[0][name]': 'Project',
        'custom_fields[0][value]': args.project,
    }
    if args.number:
        inv_params['custom_fields[1][name]'] = 'Invoice #'
        inv_params['custom_fields[1][value]'] = str(args.number)
        inv_params['metadata[legacy_invoice_number]'] = str(args.number)

    inv = stripe('POST', 'invoices', key, inv_params)
    stripe('POST', 'invoiceitems', key, {
        'customer': args.customer, 'invoice': inv['id'],
        'amount': str(int(round(net * 100))), 'currency': 'usd',
        'description': desc,
    })
    stripe('POST', 'invoiceitems', key, {
        'customer': args.customer, 'invoice': inv['id'],
        'amount': str(int(round(fee_line * 100))), 'currency': 'usd',
        'description': f'Card payment processing (pass-through at cost, '
                       f'{100 * (CARD_PCT + INVOICING_PCT):.1f}% + $0.30)',
    })

    state = 'DRAFT (review in dashboard, then --send-draft to email it)'
    if args.send:
        inv = stripe('POST', f'invoices/{inv["id"]}/finalize', key)
        stripe('POST', f'invoices/{inv["id"]}/send', key)
        state = 'SENT'

    print(f'invoice: {inv["id"]}  [{state}]')
    print(f'  invoice # (legacy):  {args.number or "—"}')
    print(f'  services:            ${net:,.2f}')
    print(f'  processing line:     ${fee_line:,.2f}')
    print(f'  invoice total:       ${total:,.2f}')
    est_net = total - (total * CARD_PCT + CARD_FIXED) - total * INVOICING_PCT
    print(f'  est. net to you:     ${est_net:,.2f}  (target ${net:,.2f})')
    print(f'  dashboard: https://dashboard.stripe.com/invoices/{inv["id"]}')
    if args.send and inv.get('hosted_invoice_url'):
        print(f'  hosted:    {inv["hosted_invoice_url"]}')


if __name__ == '__main__':
    main()
