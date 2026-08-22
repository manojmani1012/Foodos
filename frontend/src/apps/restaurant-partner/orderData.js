// Shared mock order data for the Restaurant Partner App
export const ORDERS = [
  { id: 'FD125487', customer: 'Ramesh Kumar', items: [{ name: 'Chicken Biryani', qty: 2 }], total: 548, status: 'new', time: '10:32 AM' },
  { id: 'FD125486', customer: 'Priya Sharma', items: [{ name: 'Veg Biryani', qty: 1 }, { name: 'Raita', qty: 1 }], total: 249, status: 'new', time: '10:28 AM' },
  { id: 'FD125485', customer: 'Arjun Prasad', items: [{ name: 'Mutton Biryani', qty: 1 }], total: 299, status: 'preparing', time: '10:15 AM' },
  { id: 'FD125484', customer: 'Kavya Reddy', items: [{ name: 'Chicken 65', qty: 2 }], total: 358, status: 'preparing', time: '10:10 AM' },
  { id: 'FD125483', customer: 'Karthik Nair', items: [{ name: 'Prawn Biryani', qty: 1 }], total: 319, status: 'ready', time: '09:55 AM' },
]

export function getOrder(id) {
  return ORDERS.find(o => o.id === id)
}
