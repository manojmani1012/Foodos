"""Generates the Foodos 60-Day Delivery Plan investor PDF."""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT

GREEN = colors.HexColor('#1a5c35')
LIGHT_GREEN = colors.HexColor('#e8f5e9')
DARK = colors.HexColor('#222222')
GREY = colors.HexColor('#666666')

doc = SimpleDocTemplate(
    'c:/food/Foodos_60Day_Plan.pdf',
    pagesize=A4,
    topMargin=22 * mm,
    bottomMargin=18 * mm,
    leftMargin=18 * mm,
    rightMargin=18 * mm,
)

title_style = ParagraphStyle('Title', fontName='Helvetica-Bold', fontSize=22,
                              textColor=GREEN, alignment=TA_CENTER, spaceAfter=4)
subtitle_style = ParagraphStyle('Subtitle', fontName='Helvetica', fontSize=12,
                                 textColor=GREY, alignment=TA_CENTER, spaceAfter=18)
h2 = ParagraphStyle('H2', fontName='Helvetica-Bold', fontSize=14,
                     textColor=GREEN, spaceBefore=16, spaceAfter=8)
body = ParagraphStyle('Body', fontName='Helvetica', fontSize=10,
                       textColor=DARK, alignment=TA_LEFT, leading=14)

elements = []

elements.append(Paragraph('Foodos', title_style))
elements.append(Paragraph('60-Day Delivery Plan &nbsp;|&nbsp; 2-Person Team', subtitle_style))

# Team structure
elements.append(Paragraph('Team Structure', h2))
team_data = [
    ['Role', 'Owner', 'Responsibility'],
    ['Developer 1', 'Frontend Lead', 'All 4 UI portals (Customer, Delivery Partner, Restaurant Partner, Admin)'],
    ['Developer 2', 'Backend Lead', 'APIs, Database, Real-time, Payments, DevOps'],
    ['Shared', 'Both', 'Testing, Integration, Deployment'],
]
t = Table(team_data, colWidths=[70, 90, 300])
t.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), GREEN),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
    ('FONTSIZE', (0, 0), (-1, -1), 9.5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dddddd')),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GREEN]),
    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
]))
elements.append(t)

# Phase-wise breakdown
elements.append(Paragraph('Phase-Wise Breakdown', h2))

phases = [
    ('Phase 1 — Foundation (Day 1-10)', [
        ('Frontend', 'Customer App: Splash, Login/OTP, Home (already done) then Restaurant, Food Detail, Cart screens'),
        ('Backend', 'Project setup, database schema, Auth Service (OTP + JWT), core APIs skeleton'),
        ('Milestone', 'Customer app browsing flow + login working end-to-end'),
    ]),
    ('Phase 2 — Customer App Complete (Day 11-20)', [
        ('Frontend', 'Payment Screen, Order Tracking, Profile Screen'),
        ('Backend', 'Order APIs, Payment gateway integration (Razorpay), Wallet & Coupons'),
        ('Milestone', 'Customer can browse, order, pay and track (with test data)'),
    ]),
    ('Phase 3 — Partner Apps (Day 21-35)', [
        ('Frontend', 'Delivery Partner App (all screens) + Restaurant Partner App (all screens)'),
        ('Backend', 'Delivery assignment logic, live location (WebSocket), Restaurant order APIs, menu management'),
        ('Milestone', 'Order flows end-to-end across Customer, Restaurant and Delivery Partner'),
    ]),
    ('Phase 4 — Admin Dashboard (Day 36-45)', [
        ('Frontend', 'Full Admin Dashboard (orders, restaurants, partners, analytics, payments, offers, support)'),
        ('Backend', 'Admin APIs, analytics aggregation, settlement/payout logic, notifications (Push/SMS)'),
        ('Milestone', 'Admin has full visibility and control over the platform'),
    ]),
    ('Phase 5 — Integration + Testing (Day 46-53)', [
        ('Both', 'Connect all 4 apps to live backend, fix integration bugs'),
        ('Testing', 'API testing, critical flow E2E testing (order, payment, delivery), payment sandbox testing, load testing'),
        ('Milestone', 'Stable build with no critical bugs'),
    ]),
    ('Phase 6 — Deployment + Launch Prep (Day 54-60)', [
        ('DevOps', 'Docker + CI/CD, staging to production deployment, SSL, monitoring setup'),
        ('Both', 'Final UAT, bug fixes, app store / play store submission prep'),
        ('Milestone', 'Live production-ready platform'),
    ]),
]

phase_title_style = ParagraphStyle(
    'PhaseTitle', fontName='Helvetica-Bold', fontSize=11.5,
    textColor=colors.white, leading=14,
)

for phase_title, rows in phases:
    title_row = [[Paragraph(phase_title, phase_title_style), '']]
    header = Table(title_row, colWidths=[80, 380])
    header.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('BACKGROUND', (0, 0), (-1, -1), GREEN),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))

    data = [[Paragraph(f'<b>{k}</b>', body), Paragraph(v, body)] for k, v in rows]
    pt = Table(data, colWidths=[80, 380])
    pt.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dddddd')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('BACKGROUND', (0, 0), (0, -1), LIGHT_GREEN),
    ]))
    elements.append(KeepTogether([header, pt]))
    elements.append(Spacer(1, 10))

elements.append(PageBreak())

# Effort distribution summary
elements.append(Paragraph('Effort Distribution Summary', h2))
effort_data = [
    ['Phase', 'Days', 'Focus'],
    ['1. Foundation', '10', 'Auth + Customer app start'],
    ['2. Customer App', '10', 'Payments + tracking'],
    ['3. Partner Apps', '15', 'Delivery + Restaurant apps'],
    ['4. Admin Dashboard', '10', 'Full admin panel'],
    ['5. Testing', '8', 'Integration + QA'],
    ['6. Deployment', '7', 'Go-live'],
    ['Total', '60', ''],
]
et = Table(effort_data, colWidths=[180, 60, 220])
et.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), GREEN),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTNAME', (0, 1), (-1, -2), 'Helvetica'),
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GREEN),
    ('FONTSIZE', (0, 0), (-1, -1), 9.5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dddddd')),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
]))
elements.append(et)

# What gets delivered
elements.append(Paragraph('What Gets Delivered by Day 60', h2))
deliverables = [
    'Customer App (iOS/Android-ready web build)',
    'Delivery Partner App',
    'Restaurant Partner App',
    'Admin Dashboard (web)',
    'Backend APIs: Auth, Orders, Payments, Real-time tracking, Notifications',
    'Tested, deployed on production infrastructure with monitoring',
]
for d in deliverables:
    elements.append(Paragraph(f'&#8226; {d}', body))

# Key risks
elements.append(Paragraph('Key Risks', h2))
risk_data = [
    ['Risk', 'Mitigation'],
    ['Payment gateway KYC delay', 'Start Razorpay account setup on Day 1'],
    ['Real-time tracking complexity', 'Backend dev prioritizes this in Phase 3, buffer built in'],
    ['2-person bandwidth', 'Scope locked to brochure features only, no scope creep during the 60 days'],
]
rt = Table(risk_data, colWidths=[200, 260])
rt.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), GREEN),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
    ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
    ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
    ('FONTSIZE', (0, 0), (-1, -1), 9.5),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dddddd')),
    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GREEN]),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 6),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ('LEFTPADDING', (0, 0), (-1, -1), 6),
]))
elements.append(rt)

elements.append(PageBreak())

# ---------------------------------------------------------------
# Cost & Tooling
# ---------------------------------------------------------------
elements.append(Paragraph('Cost &amp; Tooling', title_style))
elements.append(Paragraph('Third-Party Services, Infrastructure &amp; Dev Tooling', subtitle_style))

def cost_table(data, col_widths):
    tb = Table(data, colWidths=col_widths)
    tb.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), GREEN),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#dddddd')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GREEN]),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
    ]))
    return tb

def cost_block(heading, rows, col_widths=(150, 170, 140)):
    data = [['Service', 'Purpose', 'Cost']] + rows
    block = [
        Paragraph(heading, ParagraphStyle('CostH', fontName='Helvetica-Bold', fontSize=11.5,
                                           textColor=GREEN, spaceBefore=12, spaceAfter=6)),
        cost_table(data, list(col_widths)),
    ]
    elements.append(KeepTogether(block))

cost_block('1. Payments', [
    ['Razorpay', 'UPI, Card, Wallet, COD reconciliation', 'No setup fee. ~2% per transaction'],
    ['Razorpay Payouts', 'Restaurant / rider settlements', '~Rs.2-5 per payout'],
])

cost_block('2. SMS / OTP Gateway', [
    ['MSG91 / Twilio', 'OTP login (Splash to Login flow)', '~Rs.0.15-0.25 per SMS'],
    ['Estimated volume', '10,000 signups/month (2 OTPs each)', 'Rs.3,000-5,000/month'],
])

cost_block('3. Maps &amp; Location', [
    ['Google Maps Platform', 'Live tracking, navigation, ETA (rider app)', '$200 free credit/month, then pay-as-you-go'],
    ['Estimated usage', '5,000 orders/month', '$50-150/month (Rs.4,000-12,000)'],
])

cost_block('4. Push Notifications', [
    ['Firebase Cloud Messaging', 'Order status push (all 3 apps)', 'Free (unlimited)'],
])

cost_block('5. File Storage', [
    ['AWS S3 / Cloudinary', 'Menu &amp; restaurant image uploads', 'Free tier, then Rs.500-3,000/month'],
])

cost_block('6. Database', [
    ['PostgreSQL (Supabase/Railway)', 'Orders, users, menu, payments', 'Free tier, Pro from $25/month'],
    ['Redis (Upstash)', 'Cart sessions, live rider location cache', 'Free tier, then $10-20/month'],
])

cost_block('7. Hosting', [
    ['Backend API hosting', 'Node.js APIs, WebSocket server', '$7-25/month per service'],
    ['Frontend hosting (Admin panel)', 'Static hosting', 'Free tier, Pro $20/month if needed'],
])

cost_block('8. Domain &amp; SSL', [
    ['Domain (e.g. foodos.in)', 'Brand domain', 'Rs.800-1,200/year'],
    ['SSL Certificate', 'HTTPS encryption', 'Free (Lets Encrypt)'],
])

cost_block('9. App Store / Play Store', [
    ['Google Play Console', 'One-time registration', '$25 one-time (~Rs.2,100)'],
    ['Apple Developer Program', 'Yearly membership', '$99/year (~Rs.8,300/year)'],
])

cost_block('10. Monitoring', [
    ['Sentry', 'Error tracking (backend + frontend)', 'Free tier, Team plan $26/month'],
    ['UptimeRobot', 'Server uptime monitoring', 'Free'],
])

cost_block('11. AI Coding Tools', [
    ['Claude Standard Subscription', 'Agentic coding, backend logic, refactors for both devs', '$20/user/month -> 2 devs = $40/month (~Rs.3,400/month)'],
])

elements.append(Spacer(1, 10))
elements.append(Paragraph('Total Monthly Cost Estimate (Post-Launch, Moderate Scale)', h2))
total_data = [
    ['Category', 'Monthly (INR)'],
    ['Payments (Razorpay)', 'Transaction-based (2% of GMV)'],
    ['SMS / OTP', 'Rs.3,000-5,000'],
    ['Maps', 'Rs.4,000-12,000'],
    ['Storage', 'Rs.500-3,000'],
    ['Database', 'Rs.2,000-4,000'],
    ['Hosting', 'Rs.3,000-6,000'],
    ['Monitoring', 'Rs.0-2,200'],
    ['AI Coding Tools (Claude Standard x2)', 'Rs.3,400'],
    ['Total (excl. Razorpay %)', 'Rs.15,900-32,600/month'],
]
tt = cost_table(total_data, [260, 200])
tt.setStyle(TableStyle([
    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ('BACKGROUND', (0, -1), (-1, -1), LIGHT_GREEN),
]))
elements.append(tt)

elements.append(Spacer(1, 10))
elements.append(Paragraph(
    'During the 60-day build phase, only the Claude Standard subscription and basic dev hosting '
    '(~Rs.10,000-13,000/month total) are needed. Maps, SMS and Razorpay costs only apply once real '
    'usage or sandbox testing begins (mostly free in test mode). Razorpay fees scale with revenue, '
    'not a fixed monthly cost.', body))

doc.build(elements)
print('PDF generated at c:/food/Foodos_60Day_Plan.pdf')
