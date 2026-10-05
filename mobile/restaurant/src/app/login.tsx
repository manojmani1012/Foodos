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
import { colors, radius, space, type } from '@/theme'

const OTP_LENGTH = 4

export default function LoginScreen() {
  const { requestOtp, verifyOtp, status } = useAuth()
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

  if (status === 'signed-in') {
    return <Redirect href="/(tabs)" />
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
      // The usual cause is a phone that is a customer but not an owner: the
      // API refuses the role rather than silently signing them in.
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
            <View style={styles.partnerBadge}>
              <Text style={styles.partnerBadgeText}>Restaurant Partner</Text>
            </View>
          </View>

          <View style={styles.card}>
            {step === 'phone' ? (
              <>
                <Text style={styles.title}>Welcome back</Text>
                <Text style={styles.subtitle}>Sign in to manage your restaurant</Text>

                <View style={styles.phoneRow}>
                  <View style={styles.countryCode}>
                    <Text style={styles.countryCodeText}>🇮🇳 +91</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="Registered mobile number"
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={text => setPhone(text.replace(/\D/g, ''))}
                    autoFocus
                  />
                </View>

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  style={[
                    styles.primaryButton,
                    (phone.length < 10 || busy) && styles.buttonDisabled,
                  ]}
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
                  Use the number your restaurant is registered with. Contact Foodos support if it
                  has changed.
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
  screen: { flex: 1, backgroundColor: colors.brand },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },

  brand: { alignItems: 'center', paddingVertical: space.xxxl, gap: space.md },
  logo: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -0.5 },
  partnerBadge: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  partnerBadgeText: { ...type.overline, color: '#dcefe3' },

  card: {
    backgroundColor: colors.surface,
    marginHorizontal: space.lg,
    borderRadius: 20,
    padding: space.xxl - 4,
  },
  title: { ...type.title, color: colors.ink },
  subtitle: { ...type.body, color: colors.muted, marginTop: space.xs, marginBottom: space.xl },

  phoneRow: { flexDirection: 'row', gap: space.sm },
  countryCode: {
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.ground,
  },
  countryCodeText: { ...type.body, color: colors.body },
  phoneInput: {
    flex: 1,
    paddingHorizontal: space.lg - 2,
    paddingVertical: space.lg - 2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    fontSize: 16,
    color: colors.ink,
  },

  primaryButton: {
    marginTop: space.lg + 2,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  terms: {
    marginTop: space.lg,
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 17,
  },

  back: { color: colors.brand, fontSize: 16, fontWeight: '600', marginBottom: space.sm + 2 },
  otpRow: { flexDirection: 'row', gap: space.md, justifyContent: 'center' },
  otpBox: {
    width: 56,
    height: 62,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
    backgroundColor: colors.ground,
  },
  otpBoxFilled: { borderColor: colors.brand, backgroundColor: colors.surface },

  devCode: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#a9bbae',
    backgroundColor: '#f1f8f2',
    alignItems: 'center',
  },
  devCodeLabel: { ...type.overline, color: colors.brandInk },
  devCodeValue: { fontSize: 22, fontWeight: '800', letterSpacing: 6, color: colors.brand },

  error: {
    marginTop: space.lg - 2,
    padding: space.sm + 2,
    borderRadius: radius.sm + 2,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
    textAlign: 'center',
  },
  resend: { marginTop: space.lg, ...type.small, color: colors.muted, textAlign: 'center' },
  resendWait: { color: colors.muted },
  link: { color: colors.brand, fontWeight: '700' },
})
