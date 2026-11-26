"""The policy pages: Terms of Use, Privacy, Refund & Cancellation, Delivery and
Contact, served as plain HTML at /legal/<page>.

The Play Store asks each app for a privacy policy link, and Razorpay checks for
all five before it turns on live payments. They are written to match what the
apps actually do (when an order can be cancelled, how refunds go back, what a
rider's phone shares), so a change to those rules belongs here too.

Who runs Foodos (legal name, address, support contacts, Grievance Officer)
comes from settings. Until the client sends its registered details, the pages
show a placeholder like "[Company legal name]" in their place. These are
drafts: the client's lawyer should review them before launch.
"""

import html
from typing import Union

from ...config import get_settings

UPDATED = "17 November 2026"

Block = Union[str, list[str]]


def company() -> dict[str, str]:
    """The company details the pages quote, with a placeholder for each one
    not set yet."""
    settings = get_settings()

    def value(setting: str, placeholder: str) -> str:
        return setting.strip() or f"[{placeholder}]"

    support_email = settings.support_email.strip()

    return {
        "name": value(settings.company_legal_name, "Company legal name"),
        "address": value(settings.company_address, "Registered office address"),
        "jurisdiction": value(settings.company_jurisdiction, "City"),
        "email": value(support_email, "Support email"),
        "phone": value(settings.support_phone, "Support phone"),
        "hours": value(settings.support_hours, "Support hours"),
        "officer": value(settings.grievance_officer_name, "Grievance Officer name"),
        "officer_email": value(settings.grievance_officer_email or support_email, "Grievance Officer email"),
    }


# Each page: its title, a one-line summary, and (heading, blocks) sections. A
# block is a paragraph, or a list of bullet points. {name} and the like are
# filled from company().
PAGES: dict[str, dict] = {
    "terms": {
        "title": "Terms of Use",
        "summary": "The rules for using the Foodos app and website.",
        "sections": [
            (
                "About Foodos",
                [
                    "Foodos is an online platform, run by {name} (\"Foodos\", \"we\"), that lets you order food from "
                    "independent restaurants (\"restaurant partners\") and have it delivered by independent delivery "
                    "partners. These terms apply whenever you use the Foodos app or website. By creating an account or "
                    "placing an order, you agree to them.",
                    "The restaurant prepares your food and is responsible for it. Foodos takes your order and payment, "
                    "passes the order to the restaurant, and arranges the delivery.",
                ],
            ),
            (
                "Your account",
                [
                    [
                        "You sign in with your mobile number and a one-time code (OTP). Keep your phone secure: anyone "
                        "with it can use your account.",
                        "You must be 18 or older, or use Foodos with the consent of a parent or guardian.",
                        "Give your correct name, phone number and delivery address, so your food reaches you.",
                        "We may suspend or block an account used for fraud, fake orders, misuse of offers, or abuse of "
                        "restaurant or delivery partners.",
                    ]
                ],
            ),
            (
                "Orders",
                [
                    "Menus, prices, photos and dish descriptions come from the restaurants. A cash order is placed when "
                    "you confirm it; an online order is placed once your payment succeeds.",
                    "A restaurant may decline an order, for example when a dish runs out, and an order the restaurant "
                    "does not accept within 5 minutes is cancelled automatically. Either way, an online payment is "
                    "refunded in full.",
                    "Delivery times shown in the app are estimates. They depend on how busy the restaurant is, the "
                    "distance, traffic and weather.",
                ],
            ),
            (
                "Prices and payment",
                [
                    "Before you pay, the bill shows the item total, packaging charges, delivery fee, taxes (GST), any "
                    "discount, any tip you add, and the total rounded to the nearest rupee.",
                    "You can pay online (UPI, cards and other methods offered by our payment partner, Razorpay) or in "
                    "cash on delivery where it is offered. Foodos does not store your card or UPI details.",
                    "A GST invoice for every delivered order is available from the order screen.",
                ],
            ),
            (
                "Tips",
                [
                    "Tips are optional. Every rupee of a tip goes to the delivery partner who delivers your order.",
                ],
            ),
            (
                "Offers and coupons",
                [
                    "One coupon can be used per order. Each offer has its own conditions, such as a minimum order value "
                    "or first orders only, shown with the offer. Foodos may change or end an offer at any time, and may "
                    "cancel orders that misuse one.",
                ],
            ),
            (
                "Cancellations, refunds and delivery",
                [
                    "When you can cancel, and how refunds are paid, is set out in our Refund & Cancellation Policy. How "
                    "delivery works is set out in our Delivery Policy. Both are part of these terms.",
                ],
            ),
            (
                "Food safety and allergies",
                [
                    "Restaurants are responsible for preparing food safely and for holding a valid FSSAI licence. "
                    "Cooking instructions you add are requests to the restaurant, not guarantees. If you have an "
                    "allergy, check the dish description and contact the restaurant or Foodos support before ordering: "
                    "Foodos cannot guarantee that any dish is free of an allergen.",
                ],
            ),
            (
                "Ratings and reviews",
                [
                    "Ratings and reviews must be honest and about your own order. We may remove reviews that are "
                    "abusive, fake or unrelated to the order.",
                ],
            ),
            (
                "Fair use",
                [
                    [
                        "Do not place fake orders, refuse orders in bad faith, or misuse offers and refunds.",
                        "Treat restaurant and delivery partners with respect.",
                        "Do not try to break into, copy, overload or reverse-engineer Foodos.",
                    ]
                ],
            ),
            (
                "Our responsibility",
                [
                    "As far as the law allows, Foodos's responsibility for any order is limited to the amount you paid "
                    "for that order. We are not responsible for delays or failures caused by things outside our "
                    "reasonable control, such as severe weather, traffic restrictions or network outages.",
                ],
            ),
            (
                "Changes to these terms",
                [
                    "We may update these terms. The date at the top shows the latest version; using Foodos after a "
                    "change means you accept it.",
                ],
            ),
            (
                "Law and disputes",
                [
                    "These terms are governed by the laws of India. Disputes are subject to the courts at "
                    "{jurisdiction}. Before going to court, please contact us: most problems are solved quickly.",
                ],
            ),
            (
                "Contact",
                [
                    "Use Help & support in the app (Profile, then Help & support), email {email}, or call {phone}. "
                    "Our Grievance Officer's details are on the Contact page.",
                ],
            ),
        ],
    },
    "privacy": {
        "title": "Privacy Policy",
        "summary": "What Foodos collects about you, why, who sees it, and your choices.",
        "sections": [
            (
                "Who we are",
                [
                    "{name} runs Foodos: the customer app and website, the Foodos Partner app for restaurants and the "
                    "Foodos Delivery app for delivery partners. This policy explains how we handle personal data under "
                    "the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.",
                ],
            ),
            (
                "What we collect from customers",
                [
                    [
                        "Your mobile number, name and, if you add it, email address.",
                        "Your delivery addresses and their map pins. Your phone's location only when you choose \"use my "
                        "current location\".",
                        "Your orders, ratings, reviews, cart notes and support messages.",
                        "Whether a payment succeeded and its reference. Card and UPI details stay with Razorpay; Foodos "
                        "never sees or stores them.",
                        "A notification token for your phone, so we can send order updates.",
                    ]
                ],
            ),
            (
                "What we collect from restaurant partners",
                [
                    [
                        "The owner's name and mobile number.",
                        "Restaurant details: name, address, map location, FSSAI and GST numbers, menu, prices and photos.",
                        "Order and earnings records, and payout details.",
                    ]
                ],
            ),
            (
                "What we collect from delivery partners",
                [
                    [
                        "Name, mobile number, city and vehicle details.",
                        "Photos of the driving licence, vehicle RC and masked Aadhaar, used only to verify the partner. "
                        "They are stored privately and are never public.",
                        "Live location while the partner is online or carrying an order, including when the app is in the "
                        "background or the screen is off. A notification shows whenever this is happening, and it stops "
                        "when the partner goes offline.",
                        "Delivery, earnings, cash-collected and payout records.",
                    ]
                ],
            ),
            (
                "Collected automatically",
                [
                    "Sign-in records, IP address and basic device details, used to keep accounts secure and to "
                    "investigate problems.",
                ],
            ),
            (
                "How we use it",
                [
                    [
                        "To take orders, show restaurants that deliver to you, and send each order to a nearby delivery "
                        "partner.",
                        "To let you track your order and to tell you about it.",
                        "To take payments, issue refunds and GST invoices, and pay restaurant and delivery partners.",
                        "To verify partners and prevent fraud, for example by detecting fake GPS apps and limiting OTP "
                        "requests.",
                        "To answer support requests and improve Foodos.",
                        "To meet legal duties, such as tax and accounting records.",
                    ]
                ],
            ),
            (
                "Who sees what",
                [
                    [
                        "The restaurant sees your name, phone number, your order and your cooking notes.",
                        "The delivery partner sees your first name, phone number, delivery address, landmark and delivery "
                        "instructions.",
                        "You see your delivery partner's first name and vehicle number, and their phone number and live "
                        "location only while your order is on its way.",
                    ]
                ],
            ),
            (
                "Service providers",
                [
                    "We share only what each needs to do its job: our payment partner (Razorpay), the SMS provider that "
                    "sends sign-in codes, our cloud hosting and database providers, push notification services (Expo and "
                    "Google Firebase), and map providers that draw the maps. We do not sell personal data. We share data "
                    "with authorities only when the law requires it.",
                ],
            ),
            (
                "How we keep it safe",
                [
                    "Data travels over encrypted connections (HTTPS). Access inside Foodos is limited to the people who "
                    "need it, and every change made in the admin panel is logged. Partner documents are kept private. "
                    "No system is perfectly secure, but we work to protect your data and will tell you about a breach "
                    "that affects you as the law requires.",
                ],
            ),
            (
                "How long we keep it",
                [
                    "We keep your details while your account is open. When you delete your account (Settings, then "
                    "Delete my account in the customer app, or through support for partners), we remove your profile "
                    "details. Order, payment and tax records are kept for as long as tax and accounting laws require.",
                ],
            ),
            (
                "Your choices and rights",
                [
                    [
                        "See and correct your details: edit your profile in the app, or ask support.",
                        "Delete your account, as described above.",
                        "Turn off location or notifications in your phone's settings. Some features, such as delivery "
                        "to your current location, need them.",
                        "Withdraw consent, ask what we hold about you, or nominate someone to act for you, by contacting "
                        "our Grievance Officer.",
                    ]
                ],
            ),
            (
                "Children",
                [
                    "Foodos is not meant for children under 18 without a parent's or guardian's consent.",
                ],
            ),
            (
                "Changes and contact",
                [
                    "We may update this policy; the date at the top shows the latest version. Questions or complaints "
                    "about your data go to our Grievance Officer, {officer}, at {officer_email}, {address}.",
                ],
            ),
        ],
    },
    "refund": {
        "title": "Refund & Cancellation Policy",
        "summary": "When you can cancel an order, and how and when refunds reach you.",
        "sections": [
            (
                "Cancelling an order yourself",
                [
                    "You can cancel free of charge from the order screen until the restaurant accepts your order. An "
                    "online payment is then refunded in full.",
                    "Once the restaurant has started preparing your food, the order can no longer be cancelled in the "
                    "app. Contact Foodos support: whether a refund is possible depends on the situation, for example if "
                    "the order is very late.",
                ],
            ),
            (
                "Orders cancelled by the restaurant or by Foodos",
                [
                    "If the restaurant declines your order, does not accept it within 5 minutes, or Foodos has to cancel "
                    "it (for example when no delivery partner is available), the order is cancelled and an online "
                    "payment is refunded in full, including any tip.",
                ],
            ),
            (
                "Payments that did not complete",
                [
                    "An online order that is not paid within 30 minutes is dropped, and nothing is charged. If money left "
                    "your account but the order did not go through, your bank or Razorpay returns it automatically, "
                    "usually within 5-7 working days. If it does not, contact support with the payment reference.",
                ],
            ),
            (
                "Problems with a delivered order",
                [
                    "If items are missing or wrong, the food is damaged, or something else went wrong, tell us through "
                    "Help & support in the app as soon as possible, ideally within 24 hours, and choose the order. We "
                    "will check with the restaurant and the delivery partner and may refund part or all of the order.",
                ],
            ),
            (
                "How refunds are paid",
                [
                    [
                        "Online payments are refunded to the original payment method through Razorpay. Banks usually "
                        "take 5-7 working days to show it. The order screen shows when a refund has started and when it "
                        "is done.",
                        "Cash orders have nothing to refund if cancelled before delivery. If a refund is due on a "
                        "delivered cash order, Foodos support arranges it by UPI or bank transfer.",
                    ]
                ],
            ),
            (
                "Contact",
                [
                    "For any refund question, use Help & support in the app, email {email} or call {phone}.",
                ],
            ),
        ],
    },
    "delivery": {
        "title": "Delivery Policy",
        "summary": "Where Foodos delivers, how long it takes, and how your food is handed over.",
        "sections": [
            (
                "Where we deliver",
                [
                    "Foodos delivers cooked food from restaurants to addresses close to them, usually within about 7 km "
                    "(some restaurants set a different distance). The app only shows restaurants that deliver to your "
                    "address. Foodos does not ship goods by post or courier.",
                ],
            ),
            (
                "Delivery time",
                [
                    "The app shows an estimated time before you order and a live arrival time after. It depends on the "
                    "restaurant's preparation time, the distance, traffic, weather and how busy it is. Orders late at "
                    "night may take longer, and the app says so.",
                ],
            ),
            (
                "Delivery charges",
                [
                    "The delivery fee, if any, is shown on the bill before you pay.",
                ],
            ),
            (
                "Tracking and handover",
                [
                    [
                        "Once a delivery partner picks up your order, you can follow them on a live map and call them.",
                        "Your order screen shows a 4-digit delivery code. Tell it to the delivery partner only when you "
                        "have the food: the order is marked delivered only with this code.",
                        "For cash orders, please keep the amount ready.",
                        "Add a landmark and delivery instructions (for example \"leave at the door\") to help the delivery "
                        "partner find you.",
                    ]
                ],
            ),
            (
                "If you cannot be reached",
                [
                    "The delivery partner will call you if they cannot find you. If the food cannot be delivered because "
                    "the address was wrong or you could not be reached, the order may not be eligible for a refund.",
                ],
            ),
            (
                "Contact",
                [
                    "For help with a delivery, use Help & support in the app, email {email} or call {phone}.",
                ],
            ),
        ],
    },
    "contact": {
        "title": "Contact Us",
        "summary": "How to reach Foodos.",
        "sections": [
            (
                "Foodos",
                [
                    "{name}",
                    "{address}",
                ],
            ),
            (
                "Customer support",
                [
                    [
                        "In the app: Profile, then Help & support. You can raise a ticket and follow our replies there.",
                        "Email: {email}",
                        "Phone: {phone}",
                        "Hours: {hours}",
                    ]
                ],
            ),
            (
                "Grievance Officer",
                [
                    "Under the Consumer Protection (E-Commerce) Rules, 2020 and the Information Technology Act, 2000, "
                    "complaints can be sent to our Grievance Officer. We acknowledge every complaint within 48 hours and "
                    "aim to resolve it within one month.",
                    [
                        "Name: {officer}",
                        "Email: {officer_email}",
                        "Address: {address}",
                    ],
                ],
            ),
            (
                "Restaurant and delivery partners",
                [
                    "Partners can reach Foodos through the Foodos Partner or Foodos Delivery app, or by email at {email}.",
                ],
            ),
        ],
    },
}

ORDER = ["terms", "privacy", "refund", "delivery", "contact"]

STYLE = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #f6f7f5; color: #1d2420; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { background: #1a5c35; color: #fff; padding: 14px 16px; }
header a { color: #fff; text-decoration: none; font-weight: 700; font-size: 18px; }
nav { display: flex; flex-wrap: wrap; gap: 6px 14px; max-width: 760px; margin: 0 auto; padding: 12px 16px 0; font-size: 14px; }
nav a { color: #1a5c35; }
nav a[aria-current] { color: #1d2420; font-weight: 700; text-decoration: none; }
main { max-width: 760px; margin: 0 auto; padding: 8px 16px 48px; }
h1 { font-size: 26px; line-height: 1.25; margin: 16px 0 4px; }
.updated { color: #5d6a62; font-size: 14px; margin: 0 0 8px; }
.summary { color: #3a4640; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 28px 0 6px; }
p { margin: 0 0 10px; }
ul { margin: 0 0 10px; padding-left: 22px; }
li { margin-bottom: 4px; }
.card { background: #fff; border: 1px solid #e3e7e4; border-radius: 12px; padding: 14px 16px; margin-top: 16px; }
.card a { color: #1a5c35; font-weight: 600; }
footer { max-width: 760px; margin: 0 auto; padding: 0 16px 32px; color: #5d6a62; font-size: 13px; }
"""


def _fill(text: str, details: dict[str, str]) -> str:
    return html.escape(text.format(**details))


def _block(block: Block, details: dict[str, str]) -> str:
    if isinstance(block, list):
        return "<ul>" + "".join(f"<li>{_fill(item, details)}</li>" for item in block) + "</ul>"

    return f"<p>{_fill(block, details)}</p>"


def _page(title: str, current: str, body: str, details: dict[str, str]) -> str:
    here = ' aria-current="page"'
    links = "".join(
        f'<a href="/legal/{key}"{here if key == current else ""}>{html.escape(PAGES[key]["title"])}</a>'
        for key in ORDER
    )

    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>{html.escape(title)} · Foodos</title><style>{STYLE}</style></head><body>"
        "<header><a href='/legal'>Foodos</a></header>"
        f"<nav aria-label='Policies'>{links}</nav>"
        f"<main>{body}</main>"
        f"<footer>© {html.escape(details['name'])}</footer>"
        "</body></html>"
    )


def render(key: str) -> str:
    """One policy page. KeyError for a page that does not exist."""
    page = PAGES[key]
    details = company()
    sections = "".join(
        f"<h2>{html.escape(heading)}</h2>" + "".join(_block(block, details) for block in blocks)
        for heading, blocks in page["sections"]
    )
    body = (
        f"<h1>{html.escape(page['title'])}</h1>"
        f"<p class='updated'>Last updated {UPDATED}</p>"
        f"<p class='summary'>{html.escape(page['summary'])}</p>"
        f"{sections}"
    )

    return _page(page["title"], key, body, details)


def render_index() -> str:
    details = company()
    cards = "".join(
        f"<div class='card'><a href='/legal/{key}'>{html.escape(PAGES[key]['title'])}</a>"
        f"<p>{html.escape(PAGES[key]['summary'])}</p></div>"
        for key in ORDER
    )
    body = f"<h1>Foodos policies</h1><p class='updated'>Last updated {UPDATED}</p>{cards}"

    return _page("Policies", "", body, details)
