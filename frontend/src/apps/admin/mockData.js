// Shared mock data for the Admin Dashboard
export const ORDERS = [
  { id: 'FD125487', customer: 'Ramesh Kumar', restaurant: 'The Biryani House', amount: 548, status: 'Delivered', time: '10:32 AM' },
  { id: 'FD125486', customer: 'Priya Sharma', restaurant: 'Pizza Corner', amount: 299, status: 'On the Way', time: '10:28 AM' },
  { id: 'FD125485', customer: 'Arjun Prasad', restaurant: 'Burger Hub', amount: 249, status: 'Preparing', time: '10:15 AM' },
  { id: 'FD125484', customer: 'Kavya Reddy', restaurant: 'Dosa Express', amount: 358, status: 'Pending', time: '10:10 AM' },
  { id: 'FD125483', customer: 'Karthik Nair', restaurant: 'The Biryani House', amount: 319, status: 'Cancelled', time: '09:55 AM' },
  { id: 'FD125482', customer: 'Vignesh S', restaurant: 'Healthy Bowl', amount: 449, status: 'Delivered', time: '09:40 AM' },
]

export const RESTAURANTS = [
  { id: 1, name: 'The Biryani House', owner: 'Ramesh Kumar', status: 'Active', joined: '15 May 2025' },
  { id: 2, name: 'Pizza Corner', owner: 'Anita Devi', status: 'Active', joined: '14 May 2025' },
  { id: 3, name: 'Burger Hub', owner: 'Vikram Singh', status: 'Pending', joined: '13 May 2025' },
  { id: 4, name: 'Dosa Express', owner: 'Suresh Babu', status: 'Suspended', joined: '12 May 2025' },
]

export const DELIVERY_PARTNERS = [
  { id: 1, name: 'Arun Kumar', phone: '+91 98765 43210', status: 'Online', rating: 4.7, joined: '15 May 2025' },
  { id: 2, name: 'Moni Raj', phone: '+91 97531 12345', status: 'Offline', rating: 4.8, joined: '14 May 2025' },
  { id: 3, name: 'Kathiravan Y', phone: '+91 98847 65432', status: 'On Delivery', rating: 4.4, joined: '12 May 2025' },
  { id: 4, name: 'Karthik R', phone: '+91 77009 88123', status: 'Online', rating: 4.9, joined: '10 May 2025' },
]

export const CUSTOMERS = [
  { id: 1, name: 'Ramesh Kumar', phone: '+91 95436 12345', orders: 24, joined: '12 May 2025' },
  { id: 2, name: 'Priya Sharma', phone: '+91 91234 87890', orders: 8, joined: '11 May 2025' },
  { id: 3, name: 'Arjun Prasad', phone: '+91 98847 20983', orders: 42, joined: '05 May 2025' },
]

export const TRANSACTIONS = [
  { id: 'TXN15487', type: 'Order Payment', amount: 548, status: 'Success', date: '17 May, 11:30 AM' },
  { id: 'TXN15486', type: 'Restaurant Payout', amount: -420, status: 'Success', date: '17 May, 09:05 AM' },
  { id: 'TXN15485', type: 'Delivery Partner Payout', amount: -120, status: 'Success', date: '17 May, 08:30 AM' },
  { id: 'TXN15484', type: 'Refund', amount: -229, status: 'Success', date: '17 May, 07:15 AM' },
]

export const OFFERS = [
  { id: 1, name: 'NEW60', type: 'First Order', discount: '50% up to ₹100', usage: 2410, status: 'Active' },
  { id: 2, name: 'FLAT100', type: 'Flat ₹100 off', discount: '₹100 off above ₹499', usage: 1356, status: 'Active' },
  { id: 3, name: 'FREEDEL', type: 'Free Delivery', discount: 'Free Delivery', usage: 6478, status: 'Active' },
  { id: 4, name: 'WEEKEND30', type: 'Weekend Special', discount: '30% up to ₹150', usage: 890, status: 'Scheduled' },
]

export const TICKETS = [
  { id: 'TCK125487', subject: 'Order not received', priority: 'High', status: 'Open', createdOn: '17 May 2025' },
  { id: 'TCK125486', subject: 'Refund delayed', priority: 'Medium', status: 'In Progress', createdOn: '17 May 2025' },
  { id: 'TCK125485', subject: 'Wrong item delivered', priority: 'Low', status: 'Resolved', createdOn: '16 May 2025' },
]

export const SYSTEM_LOGS = [
  { time: '10:30:15 AM', action: 'Admin Login', module: 'Dashboard', ip: '192.168.1.1' },
  { time: '10:15:40 AM', action: 'Updated order status', module: 'Orders', ip: '192.168.1.1' },
  { time: '09:45:20 AM', action: 'Added new restaurant', module: 'Restaurants', ip: '192.168.1.1' },
]

export const STATS = {
  totalOrders: 12842,
  totalRevenue: 1875420,
  activeRestaurants: 1098,
  deliveryPartners: 2316,
}
