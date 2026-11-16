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

export type PayoutRecord = {
  id: string
  periodStart: string
  periodEnd: string
  netPaise: number
  reference: string
  paidAt: string | null
}

export type StatementLine = {
  partyId: string
  name: string | null
  contact: { name: string | null; phone: string; upi?: string | null }
  count: number
  breakdown: Record<string, number>
  grossPaise: number
  commissionPaise: number
  adjustmentsPaise: number
  netPaise: number
  payout: PayoutRecord | null
  overlaps: PayoutRecord[]
}

export type Statement = {
  partyType: 'restaurant' | 'delivery_partner'
  periodStart: string
  periodEnd: string
  canRecord: boolean
  lines: StatementLine[]
  totals: {
    count: number
    grossPaise: number
    commissionPaise: number
    adjustmentsPaise: number
    netPaise: number
    unpaidNetPaise: number
  }
}

export type PayoutHistoryRow = PayoutRecord & {
  partyType: 'restaurant' | 'delivery_partner'
  partyId: string
  partyName: string | null
  grossPaise: number
  commissionPaise: number
  adjustmentsPaise: number
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
