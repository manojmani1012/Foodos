// Shapes of what the admin API returns. Money is always integer paise.

export type Counts = Record<string, number>

export type StuckOrder = {
  id: string
  orderNumber: string
  status: string
  restaurant: string
  since: string
  minutes: number
  amountPaise?: number
}

export type Dashboard = {
  today: {
    orders: number
    delivered: number
    cancelled: number
    deliveredPaise: number
    commissionPaise: number
    averageOrderPaise: number
  }
  live: { awaitingPayment: number; awaitingRestaurant: number; preparing: number; ready: number; onTheWay: number }
  riders: { active: number; online: number; busy: number; pending: number }
  restaurants: { live: number; accepting: number; pending: number }
  customers: { total: number; newToday: number }
  // Tickets nobody at Foodos has answered yet.
  support?: { waiting: number }
  attention: { waitingForRestaurant: StuckOrder[]; waitingForRider: StuckOrder[]; failedRefunds: StuckOrder[] }
  daily: { date: string; orders: number; cancelled: number; deliveredPaise: number }[]
}

export type RestaurantRow = {
  id: string
  name: string
  cuisines: string[]
  area: string
  city: string
  status: string
  isAcceptingOrders: boolean
  rating: number
  ratingCount: number
  commissionPct: number
  imageUrl: string | null
  hasLocation: boolean
  owner: { name: string | null; phone: string }
  menuItems: number
  deliveredLast30Days: number
  createdAt: string
}

export type Restaurant = {
  id: string
  name: string
  description: string | null
  cuisines: string[]
  addressLine: string
  city: string
  pincode: string | null
  latitude: number | null
  longitude: number | null
  phone: string | null
  imageUrl: string | null
  isVeg: boolean
  fssaiNumber: string | null
  gstNumber: string | null
  commissionPct: number
  commissionPlan?: 'standard' | 'subscription' | 'custom'
  // Where Foodos sends the owner's money; entered in the Restaurant app.
  payoutAccount?: PayoutAccount | null
  avgPrepMinutes: number
  // Blank means the platform default (7 km).
  deliveryRadiusKm: number | null
  rating: number
  ratingCount: number
  status: string
  isAcceptingOrders: boolean
  opensAt: string | null
  closesAt: string | null
  createdAt: string
  owner: { id: string; name: string | null; phone: string; status: string; lastSignedInAt: string | null }
  menu: { items: number; available: number; withPhoto: number }
  orders: {
    total: number
    last30Days: number
    deliveredLast30Days: number
    cancelledLast30Days: number
    deliveredPaiseLast30Days: number
  }
  checklist: { ownerSignedIn: boolean; hasMenu: boolean; hasLocation: boolean; hasCoverPhoto: boolean; hasFssai: boolean }
  recentOrders: { id: string; orderNumber: string; status: string; totalPaise: number; placedAt: string; customerName: string | null }[]
}

export type MenuCategory = {
  id: string | null
  name: string
  items: {
    id: string
    name: string
    description: string | null
    pricePaise: number
    imageUrl: string | null
    isVeg: boolean
    isAvailable: boolean
    addons: number
  }[]
}

export type RiderDocument = {
  type: 'driving_license' | 'vehicle_rc' | 'aadhaar'
  label: string
  status: 'missing' | 'pending' | 'verified' | 'rejected'
  rejectionReason: string | null
  uploadedAt: string | null
  // Loads with the admin's sign-in (apiBlob); null until uploaded.
  fileUrl: string | null
}

export type RiderRow = {
  id: string
  name: string | null
  phone: string
  city: string | null
  vehicleType: string
  vehicleNumber: string | null
  status: string
  isOnline: boolean
  accountBlocked: boolean
  // A test account: gets only test orders, anywhere.
  isTest: boolean
  lastSeenAt: string | null
  rating: number
  ratingCount: number
  deliveries: number
  deliveriesToday: number
  carryingOrder: string | null
  joinedAt: string
}

export type Rider = Omit<RiderRow, 'deliveries' | 'deliveriesToday' | 'carryingOrder' | 'lastSeenAt'> & {
  licenseNumber: string | null
  lastSignedInAt: string | null
  location: { latitude: number; longitude: number; updatedAt: string | null } | null
  stats: {
    deliveries: number
    deliveriesLast7Days: number
    earnedPaiseLast7Days: number
    // TDS deducted from those earnings, when the API reports it.
    tdsPaiseLast7Days?: number
    distanceKmLast7Days: number
    cashHeldTodayPaise: number
  }
  // Cash from cash orders not yet handed over or settled; at the limit the
  // rider gets only prepaid orders. 0 = no limit.
  cash: {
    inHandPaise: number
    limitPaise: number
    limitReached: boolean
    deposits: { id: string; amountPaise: number; reference: string | null; recordedBy: string | null; createdAt: string }[]
  }
  // Fake GPS seen on their phone: times (one per 10 minutes of use).
  fakeGps: { count: number; lastSeenAt: string | null }
  documents: RiderDocument[]
  // Where Foodos sends the rider's money; bank or UPI. Full account number.
  payoutAccount?: PayoutAccount | null
  recentDeliveries: {
    id: string
    status: string
    orderId: string
    orderNumber: string
    restaurant: string
    paymentMethod: string
    orderTotalPaise: number
    earningPaise: number
    distanceKm: number | null
    acceptedAt: string | null
    deliveredAt: string | null
  }[]
}

export type OrderRow = {
  id: string
  orderNumber: string
  status: string
  totalPaise: number
  itemCount: number
  paymentMethod: string
  paymentStatus: string
  placedAt: string
  cancelledBy: string | null
  restaurant: { id: string; name: string }
  customer: { id: string; name: string | null; phone: string }
  deliveryStatus: string | null
  riderName: string | null
  // Two riders can share a name; these tell them apart.
  riderPhone: string | null
  riderCity: string | null
  // Minutes the order has been looking for a rider, while it is.
  riderWaitMinutes: number | null
  refundStatus: string | null
  // Placed by a test account: test riders only, no location check, not paid out.
  isTest: boolean
}

export type Order = {
  id: string
  orderNumber: string
  status: string
  restaurant: { id: string; name: string; address: string; phone: string | null }
  deliveryAddress: Record<string, any>
  items: {
    id: string
    name: string
    isVeg: boolean
    unitPricePaise: number
    quantity: number
    lineTotalPaise: number
    addons: { name: string; pricePaise: number }[]
  }[]
  subtotalPaise: number
  deliveryFeePaise: number
  packagingFeePaise: number
  taxPaise: number
  tipPaise: number
  discountPaise: number
  roundOffPaise: number
  totalPaise: number
  paymentMethod: string
  paymentStatus: string
  specialInstructions: string | null
  placedAt: string
  deliveredAt: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  cancelledBy: string | null
  refund: { status: string; amountPaise: number; requestedAt: string | null; processedAt: string | null } | null
  timeline: { status: string; note: string | null; at: string }[]
  customer: { id: string; name: string | null; phone: string; blocked: boolean }
  restaurantOwner: { name: string | null; phone: string }
  rider: {
    id: string
    name: string | null
    phone: string
    city: string | null
    deliveryStatus: string
    payPaise: number
    distanceKm: number | null
    acceptedAt: string | null
  } | null
  deliveryStatus: string | null
  riderWaitMinutes: number | null
  // The customer's code, for support to read to a rider who cannot get it.
  deliveryCode: string | null
  isTest: boolean
  commissionPaise: number
  commissionPct: number
  // Foodos's payment-gateway fee on the order, when the API reports it.
  gatewayFeePaise?: number
  payments: {
    provider: string
    method: string
    amountPaise: number
    status: string
    providerOrderId: string | null
    providerPaymentId: string | null
    failureReason: string | null
    createdAt: string
  }[]
  refunds: {
    status: string
    amountPaise: number
    reason: string | null
    providerRefundId: string | null
    requestedBy: string | null
    requestedAt: string
    processedAt: string | null
    // Partial refunds by Foodos: who bears it, and where the money went.
    chargedTo?: RefundChargedTo | null
    destination?: 'original' | 'wallet' | null
  }[]
  actions: { canCancel: boolean; canRetryRefund: boolean; canAssignRider: boolean }
}

export type RiderOption = {
  id: string
  name: string | null
  phone: string
  city: string | null
  vehicleType: string | null
  vehicleNumber: string | null
  isOnline: boolean
  isTest: boolean
  distanceKm: number | null
  latitude: number | null
  longitude: number | null
  lastLocationAt: string | null
  secondsSinceLocation: number | null
  busyWith: string | null
  offerStatus: 'sent' | 'accepted' | 'rejected' | 'expired' | null
  isCurrentRider: boolean
  canAssign: boolean
}

export type RidersForOrder = {
  restaurant: { name: string; latitude: number | null; longitude: number | null }
  deliveryStatus: string | null
  minutesWaiting: number | null
  locationFreshSeconds: number
  riders: RiderOption[]
}

export type CustomerRow = {
  id: string
  name: string | null
  phone: string
  email: string | null
  blocked: boolean
  isTest: boolean
  orders: number
  spentPaise: number
  lastOrderAt: string | null
  joinedAt: string
}

export type Customer = {
  id: string
  name: string | null
  phone: string
  email: string | null
  blocked: boolean
  isTest: boolean
  joinedAt: string
  lastSignedInAt: string | null
  otherRoles: string[]
  // The Foodos wallet: what they hold, and the latest movements.
  wallet: {
    balancePaise: number
    transactions: {
      id: number
      type: 'credit' | 'debit'
      label: string
      amountPaise: number
      balanceAfterPaise: number
      orderNumber: string | null
      note: string | null
      createdAt: string
    }[]
  }
  stats: { orders: number; delivered: number; cancelled: number; cancelledByCustomer: number; spentPaise: number }
  addresses: { label: string; address: string; isDefault: boolean }[]
  recentOrders: {
    id: string
    orderNumber: string
    status: string
    totalPaise: number
    paymentMethod: string
    placedAt: string
    restaurant: string
  }[]
}

export type Offer = {
  id: string
  name: string
  code: string
  type: 'percent' | 'flat' | 'free_delivery'
  percentOff: number | null
  flatOffPaise: number | null
  maxDiscountPaise: number | null
  minOrderPaise: number
  firstOrderOnly: boolean
  // Who pays for the discount: the restaurant, or a bank / card partner.
  fundedBy?: 'restaurant' | 'bank'
  restaurant: { id: string; name: string } | null
  usageLimit: number | null
  perUserLimit: number
  validFrom: string
  validUntil: string | null
  isActive: boolean
  state: 'live' | 'paused' | 'scheduled' | 'expired' | 'used_up'
  redemptions: number
  discountGivenPaise: number
  createdAt: string
}

export type PartyType = 'restaurant' | 'delivery_partner'

export type PayoutStatus = 'pending' | 'scheduled' | 'on_hold' | 'processing' | 'paid' | 'failed' | 'cancelled'

// Payment settings, edited under Settings. Money in paise, percentages as numbers.
export type PaymentSettings = {
  commissionStandardPct: number
  commissionSubscriptionPct: number
  paymentGatewayFeePct?: number
  // Whether the restaurant's coupon discount is taken off before commission is worked out.
  commissionBase?: 'before_discount' | 'after_discount'
  gstOnCommissionPct: number
  riderTdsPct?: number
  restaurantTdsPct: number
  riderBasePaise: number
  riderBaseKm: number
  riderPerKmPaise: number
  riderOrderIncentivePaise: number
  riderDistanceBasis: 'trip' | 'drop'
  // ISO weekdays, 1 = Monday ... 7 = Sunday.
  payoutSchedule: { days: number[]; payWeekday: number }[]
  cutoffTime: string
  minPayoutPaise: number
  reservePaise?: number
  refundChargedToDefault: RefundChargedTo
  payoutTime?: string
}

export type Holiday = { day: string; name: string }

export type BankFunds = {
  balancePaise: number | null
  balanceAt: string | null
  reservePaise: number
  waitingOnBankPaise: number
  paidSinceBalancePaise: number
  availablePaise: number | null
  due: CountAndAmount
  ready: CountAndAmount
  upi: CountAndAmount
  blocked: CountAndAmount
  waitingForFunds: CountAndAmount
  shortfallPaise: number
  oldestWaiting: { payoutId: string; partyName: string | null; netPaise: number; periodStart: string } | null
}

export type BankFile = {
  id: string
  number: number
  createdAt: string
  createdBy: string | null
  paymentCount: number
  totalPaise: number
  cancelledAt: string | null
  waiting: number
  paid: number
  failed: number
}

export type BankResult = {
  applied: boolean
  rows: {
    row: number
    reference: string
    utr: string | null
    reason: string | null
    payoutId: string | null
    partyName: string | null
    amountPaise: number | null
    outcome: 'paid' | 'failed' | 'done' | 'problem'
    message: string | null
  }[]
  summary: { paid: number; failed: number; done: number; problem: number }
}

export type RefundChargedTo = 'restaurant' | 'rider' | 'foodos'

export type CountAndAmount = { count: number; netPaise: number }

export type FinanceOverview = {
  period: { from: string; to: string }
  collections: { onlinePaise: number; walletPaise: number; cashPaise: number; totalPaise: number; refundsPaise: number }
  commission: { commissionPaise: number; gatewayFeePaise?: number; gstOnCommissionPaise: number; deliveryFeesPaise: number }
  payable: { restaurantsPaise: number; ridersPaise: number; riderOwesPaise: number }
  payouts: {
    scheduled: CountAndAmount
    onHold: CountAndAmount
    failed: CountAndAmount
    paid: CountAndAmount
    dueToday: CountAndAmount
    blocked?: CountAndAmount
  }
  nextPayDates: { date: string; count: number; netPaise: number }[]
}

export type PayoutBlocker = 'bank_missing' | 'bank_pending' | 'bank_rejected'

export type PayoutRow = {
  id: string
  partyType: PartyType
  partyId: string
  partyName: string | null
  contact: { name: string | null; phone: string | null }
  status: PayoutStatus
  scheduledFor: string | null
  periodStart: string
  periodEnd: string
  grossPaise: number
  commissionPaise: number
  adjustmentsPaise: number
  netPaise: number
  reference: string | null
  paidAt: string | null
  holdReason: string | null
  failureReason: string | null
  bank: { verified: boolean; summary: string | null }
  blocker?: PayoutBlocker | null
  entryCount: number
}

export type LedgerEntry = {
  id: number | string
  kind: 'order' | 'delivery' | 'cash_collected' | 'cash_deposit' | 'refund' | 'adjustment' | string
  orderId: string | null
  orderNumber: string | null
  businessDate: string
  amountPaise: number
  breakdown: Record<string, number>
  note: string | null
  createdAt: string
}

export type Payout = PayoutRow & {
  bankDetails: {
    holder: string | null
    accountNumber: string | null
    ifsc: string | null
    bankName: string | null
    upiId: string | null
  } | null
  entries: LedgerEntry[]
  history: { action: string; by: string | null; at: string; note: string | null }[]
}

export type UnpaidParty = {
  partyType: PartyType
  partyId: string
  partyName: string | null
  duePaise: number
  entryCount: number
  oldestDate: string | null
  belowMinimum: boolean
}

export type Unpaid = { parties: UnpaidParty[]; excluded: { count: number; amountPaise: number } }

export type PayoutAccount = {
  holder: string | null
  accountNumber: string | null
  ifsc: string | null
  bankName: string | null
  upiId: string | null
  status: 'pending' | 'verified' | 'rejected'
  rejectReason: string | null
  updatedAt: string | null
}

export type Activity = {
  id: number
  action: string
  module: string
  entityType: string | null
  entityId: string | null
  details: Record<string, any>
  ip: string | null
  actor: string | null
  at: string
}

// "Complete 15 trips, earn ₹250 extra", run every day until stopped.
export type DailyTarget = {
  id: string
  name: string
  targetTrips: number
  bonusPaise: number
  live: boolean
  startsAt: string
  endsAt: string | null
  reachedToday: number
  reachedTotal: number
  paidTotalPaise: number
}

export type SupportTicketRow = {
  id: string
  ticketNumber: string
  subject: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  priority: 'low' | 'medium' | 'high'
  // Which app it came from.
  role: 'customer' | 'restaurant_owner' | 'delivery_partner'
  person: { id: string; name: string | null; phone: string }
  order: { id: string; orderNumber: string; status?: string } | null
  lastMessage: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

export type SupportTicket = SupportTicketRow & {
  resolvedAt: string | null
  messages: { id: string; fromSupport: boolean; author: string | null; body: string; internal: boolean; createdAt: string }[]
}

export type PayoutBatch = {
  id: string
  payDate: string
  periodStart: string
  periodEnd: string
  holdReason: string | null
  counts: { scheduled: number; on_hold: number; failed: number; paid: number; cancelled: number; processing: number }
  payoutCount: number
  netPaise: number
  blockedCount: number
}
