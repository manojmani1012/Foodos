import { Redirect } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { theme } from '@/theme'

const OTP_LENGTH = 4

export default function LoginScreen() {
  const { requestOtp, verifyOtp, status, isSignedIn } = useAuth()
  const [phone, setPhone] = useState('')
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [devCode, setDevCode] = useState('')
  const [resendIn, setResendIn] = useState(0)

  // Guards against a second submit while the first is still in flight.
  const submitting = useRef(false)
  const otpInputs = useRef<(TextInput | null)[]>([])

  useEffect(() => {
    if (resendIn <= 0) return

    const timer = setTimeout(() => setResendIn(seconds => seconds - 1), 1000)

    return () => clearTimeout(timer)
  }, [resendIn])

  if (status === 'signed-in' || isSignedIn) {
    return <Redirect href="/" />
  }

  async function sendCode() {
    if (phone.length < 10 || busy) return

    setBusy(true)
    setError('')

    try {
      const result = await requestOtp(phone)

      setStep('otp')
      setOtp(Array(OTP_LENGTH).fill(''))
      setResendIn(30)
      // Shown only while the backend runs without an SMS gateway.
      setDevCode(result.devCode || '')
      setTimeout(() => otpInputs.current[0]?.focus(), 100)
    } catch (requestError: any) {
      setError(requestError.message)

      if (requestError.details?.retryAfterSeconds) {
        setResendIn(requestError.details.retryAfterSeconds)
      }
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(code: string) {
    if (submitting.current) return

    submitting.current = true
    setBusy(true)
    setError('')

    try {
      await verifyOtp(phone, code)
      // The redirect above fires once the context flips to signed-in.
    } catch (verifyError: any) {
      setError(verifyError.message)
      setOtp(Array(OTP_LENGTH).fill(''))
      otpInputs.current[0]?.focus()
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    setError('')

    if (digit && index < OTP_LENGTH - 1) {
      otpInputs.current[index + 1]?.focus()
    }

    if (next.every(d => d !== '')) {
      submitCode(next.join(''))
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Text style={styles.logo}>Foodos</Text>
            <Text style={styles.tagline}>Good Food. Fast Delivery.</Text>
          </View>

          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Log in or sign up to continue</Text>

                <View style={styles.phoneRow}>
                  <View style={styles.countryCode}>
                    <Text style={styles.countryCodeText}>🇮🇳 +91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Enter mobile number"
                    placeholderTextColor={theme.muted}
                    keyboardType="number-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={text => setPhone(text.replace(/\D/g, ''))}
                    autoFocus
                  />
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  style={[styles.primaryButton, (phone.length < 10 || busy) && styles.buttonDisabled]}
                  onPress={sendCode}
                  disabled={phone.length < 10 || busy}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Continue</Text>
                  )}
                </Pressable>

                <Text style={styles.terms}>
                  By continuing you agree to our Terms &amp; Conditions and Privacy Policy
                </Text>
              </>
            ) : (
              <>
                <Pressable onPress={() => setStep('phone')} hitSlop={12}>
                  <Text style={styles.back}>‹ Back</Text>
                </Pressable>

                <Text style={styles.title}>Enter OTP</Text>
                <Text style={styles.subtitle}>Sent to +91 {phone}</Text>

                <View style={styles.otpRow}>
                  {otp.map((digit, index) => (
                    <TextInput
                      key={index}
                      ref={element => {
                        otpInputs.current[index] = element
                      }}
                      style={[styles.otpBox, digit ? styles.otpBoxFilled : null]}
                      keyboardType="number-pad"
                      maxLength={1}
                      value={digit}
                      onChangeText={value => handleOtpChange(index, value)}
                      onKeyPress={({ nativeEvent }) => {
                        // Backspace on an empty box steps back a field.
                        if (nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
                          otpInputs.current[index - 1]?.focus()
                        }
                      }}
                    />
                  ))}
                </View>

                {devCode ? (
                  <View style={styles.devCode}>
                    <Text style={styles.devCodeLabel}>Development code</Text>
                    <Text style={styles.devCodeValue}>{devCode}</Text>
                  </View>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Text style={styles.resend}>
                  Didn&apos;t receive it?{' '}
                  {resendIn > 0 ? (
                    <Text style={styles.resendWait}>Resend in {resendIn}s</Text>
                  ) : (
                    <Text style={styles.link} onPress={sendCode}>
                      Resend OTP
                    </Text>
                  )}
                </Text>

                <Pressable
                  style={[styles.primaryButton, busy && styles.buttonDisabled]}
                  onPress={() => submitCode(otp.join(''))}
                  disabled={busy || otp.some(d => !d)}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Verify &amp; Continue</Text>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.brand },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', paddingVertical: 36 },
  logo: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { color: '#cfe8d6', fontSize: 14, marginTop: 6 },
  card: {
    backgroundColor: theme.surface,
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 24,
  },
  title: { fontSize: 22, fontWeight: '700', color: theme.ink },
  subtitle: { fontSize: 14, color: theme.muted, marginTop: 4, marginBottom: 20 },
  phoneRow: { flexDirection: 'row', gap: 8 },
  countryCode: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    backgroundColor: theme.ground,
  },
  countryCodeText: { fontSize: 15, color: theme.body },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    fontSize: 16,
    color: theme.ink,
  },
  primaryButton: {
    marginTop: 18,
    backgroundColor: theme.brand,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  terms: { marginTop: 16, fontSize: 11.5, color: theme.muted, textAlign: 'center', lineHeight: 17 },
  back: { color: theme.brand, fontSize: 16, fontWeight: '600', marginBottom: 10 },
  otpRow: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  otpBox: {
    width: 56,
    height: 62,
    borderWidth: 1.5,
    borderColor: theme.line,
    borderRadius: theme.radius,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: theme.ink,
    backgroundColor: theme.ground,
  },
  otpBoxFilled: { borderColor: theme.brand, backgroundColor: theme.surface },
  devCode: {
    marginTop: 16,
    padding: 12,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#a9bbae',
    backgroundColor: '#f1f8f2',
    alignItems: 'center',
  },
  devCodeLabel: { fontSize: 11, color: theme.brandDark, letterSpacing: 0.5 },
  devCodeValue: { fontSize: 22, fontWeight: '800', letterSpacing: 6, color: theme.brand },
  error: {
    marginTop: 14,
    padding: 10,
    borderRadius: 10,
    backgroundColor: theme.dangerSoft,
    color: theme.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  resend: { marginTop: 16, fontSize: 13.5, color: theme.muted, textAlign: 'center' },
  resendWait: { color: theme.muted },
  link: { color: theme.brand, fontWeight: '700' },
})
