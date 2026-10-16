import { Alert, Platform } from 'react-native'

// A yes/no question before something that cannot be taken back.
//
// On the phone it is the system dialog. React Native's Alert does nothing in a
// browser, so the website uses the browser's own confirm box instead; without
// this, buttons like Sign out would silently do nothing there.
export function confirmAction({
  title,
  message,
  confirmText,
  destructive = false,
}: {
  title: string
  message: string
  confirmText: string
  destructive?: boolean
}): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`))
  }

  return new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

// A message with only an OK button.
export function tell(title: string, message: string): void {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`)
    return
  }

  Alert.alert(title, message)
}
