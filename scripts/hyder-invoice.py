#!/usr/bin/env python3
"""
Create a Stripe invoice for a consulting client with card-fee pass-through.

The invoice total is grossed up so that after Stripe's card fee (2.9% + $0.30)
and the Stripe Invoicing fee (0.4%), the NET deposit equals the amount you
asked to bill. The pass-through appears as its own disclosed line item.

Usage:
  python3 scripts/hyder-invoice.py --amount 12500 --desc "July retainer — Maps Initiative"
  python3 scripts/hyder-invoice.py --amount 5000 --desc "..." --email ap@dunhamlaw.com --send

Defaults: Dunham & Jones customer (cus_Uw5M9wF2y8gJVR), card-only payment
(Amex accepted), net-30, DRAFT unless --send. Drafts are reviewable/voidable
in the Stripe dashboard and send nothing to the client.
"""

import argparse
import json
import re
import subprocess

CUSTOMER = 'cus_Uw5M9wF2y8gJVR'   # Dunham & Jones
CARD_PCT = 0.029                   # Stripe card rate (Amex same on blended pricing)
CARD_FIXED = 0.30
INVOICING_PCT = 0.004              # Stripe Invoicing fee (per paid invoice)


def stripe_key():
    for line in open('/Users/kennyhyder/Projects/hyder-media/sportsbookish/.env.local'):
        m = re.match(r'^STRIPE_SECRET_KEY=(.+)$', line.strip())
        if m:
            return m.group(1).strip('"')
    raise SystemExit('no live Stripe key found')


def stripe(method, path, key, params=None):
    cmd = ['curl', '-s', f'https://api.stripe.com/v1/{path}', '-u', f'{key}:']
    if method == 'POST':
        for k, v in (params or {}).items():
            cmd += ['--data-urlencode', f'{k}={v}']
    out = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
    if 'error' in out:
        raise SystemExit(f"Stripe error: {out['error']['message']}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--amount', type=float, required=True, help='amount you want to NET, in dollars')
    ap.add_argument('--desc', required=True, help='invoice line description')
    ap.add_argument('--email', help='set/update the customer billing email')
    ap.add_argument('--customer', default=CUSTOMER)
    ap.add_argument('--send', action='store_true', help='finalize and email the invoice')
    args = ap.parse_args()

    key = stripe_key()
    net = round(args.amount, 2)
    total = round((net + CARD_FIXED) / (1 - CARD_PCT - INVOICING_PCT), 2)
    fee_line = round(total - net, 2)

    if args.email:
        stripe('POST', f'customers/{args.customer}', key, {'email': args.email})

    inv = stripe('POST', 'invoices', key, {
        'customer': args.customer,
        'collection_method': 'send_invoice',
        'days_until_due': 30,
        'payment_settings[payment_method_types][0]': 'card',
        'footer': ('Payment by credit card (American Express accepted). The card '
                   'processing line reflects actual payment-processing costs passed '
                   'through at cost, per client request. To pay by ACH/check at the '
                   'services amount with no processing line, reply to this invoice.'),
        'metadata[client]': 'dunham',
    })
    stripe('POST', 'invoiceitems', key, {
        'customer': args.customer, 'invoice': inv['id'],
        'amount': str(int(round(net * 100))), 'currency': 'usd',
        'description': args.desc,
    })
    stripe('POST', 'invoiceitems', key, {
        'customer': args.customer, 'invoice': inv['id'],
        'amount': str(int(round(fee_line * 100))), 'currency': 'usd',
        'description': f'Card payment processing (pass-through at cost, {100 * (CARD_PCT + INVOICING_PCT):.1f}% + $0.30)',
    })

    if args.send:
        inv = stripe('POST', f'invoices/{inv["id"]}/finalize', key)
        stripe('POST', f'invoices/{inv["id"]}/send', key)
        state = 'SENT'
    else:
        state = 'DRAFT (review in dashboard, nothing sent)'

    est_net = total - (total * CARD_PCT + CARD_FIXED) - total * INVOICING_PCT
    print(f'invoice: {inv["id"]}  [{state}]')
    print(f'  services:        ${net:,.2f}')
    print(f'  processing line: ${fee_line:,.2f}')
    print(f'  invoice total:   ${total:,.2f}')
    print(f'  est. net to you: ${est_net:,.2f}  (target ${net:,.2f})')
    print(f'  dashboard: https://dashboard.stripe.com/invoices/{inv["id"]}')


if __name__ == '__main__':
    main()
