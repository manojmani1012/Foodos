// The website has no push notifications: the order page refreshes itself
// while an order is on its way. These keep the same shape as the phone version.

export async function registerForPush(): Promise<void> {}

export async function forgetPushToken(): Promise<void> {}
