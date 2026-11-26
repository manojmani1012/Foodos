import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import {
  ACCOUNT_NUMBER_PATTERN,
  IFSC_PATTERN,
  fetchPayoutAccount,
  payoutAccountStatusLabel,
  savePayoutAccount,
  type PayoutAccount,
  type PayoutAccountChanges,
} from '@/lib/delivery'
import { colors, radius, shadow, space, type } from '@/theme'

export default function BankScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [account, setAccount] = useState<PayoutAccount | null>(null)

  const [holder, setHolder] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [confirmNumber, setConfirmNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [bankName, setBankName] = useState('')

  useEffect(() => {
    fetchPayoutAccount()
      .then(loaded => {
        setAccount(loaded)
        setHolder(loaded?.holder ?? '')
        setIfsc(loaded?.ifsc ?? '')
        setBankName(loaded?.bankName ?? '')
      })
      .catch(loadError => setError(loadError.message || 'Could not load your bank details'))
      .finally(() => setLoading(false))
  }, [])

  // The saved number is only ever shown masked, so it is kept unless a new one is typed.
  const hasSavedNumber = !!account?.accountNumberMasked
  const number = accountNumber.replace(/\s/g, '')
  const confirm = confirmNumber.replace(/\s/g, '')
  const code = ifsc.trim().toUpperCase()
  const name = holder.trim()

  const bankComplete = !!name && !!code && (!!number || hasSavedNumber)

  const problems: string[] = []

  if (number && !ACCOUNT_NUMBER_PATTERN.test(number)) problems.push('Account number must be 9 to 18 digits.')
  if (number && number !== confirm) problems.push('The two account numbers do not match.')
  if (code && !IFSC_PATTERN.test(code)) problems.push('IFSC looks wrong. It is 11 characters, like HDFC0001234.')
  if (!bankComplete) problems.push('Fill in the account holder name, account number and IFSC.')

  const valid = problems.length === 0

  async function save() {
    if (!valid || saving) return

    const changes: PayoutAccountChanges = {
      holder: name,
      ifsc: code,
      bankName: bankName.trim() || null,
    }

    if (number) changes.accountNumber = number

    setSaving(true)
    setError('')

    try {
      await savePayoutAccount(changes)
      router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save your bank details')
      setSaving(false)
    }
  }

  function confirmSave() {
    if (!valid || saving) return

    if (account?.status === 'verified') {
      Alert.alert(
        'Change verified details?',
        'Foodos will check the new details again before sending payouts to them. Until then they show as pending.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save changes', onPress: save },
        ],
      )
      return
    }

    save()
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScreenHeader title="Bank account for payouts" />
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  const status = account?.status

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScreenHeader title="Bank account for payouts" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {account ? (
            <View
              style={[
                styles.status,
                status === 'verified' ? styles.statusGood : status === 'rejected' ? styles.statusBad : styles.statusWait,
              ]}
            >
              <Feather
                name={status === 'verified' ? 'check-circle' : status === 'rejected' ? 'x-circle' : 'clock'}
                size={18}
                color={status === 'verified' ? colors.brand : status === 'rejected' ? colors.danger : colors.warning}
              />
              <View style={styles.flex}>
                <Text
                  style={[
                    styles.statusTitle,
                    { color: status === 'verified' ? colors.brand : status === 'rejected' ? colors.danger : colors.warning },
                  ]}
                >
                  {payoutAccountStatusLabel(account)}
                </Text>
                <Text style={styles.statusText}>
                  {status === 'rejected'
                    ? account.rejectReason || 'Please check your details and save them again.'
                    : status === 'verified'
                      ? 'Foodos sends your payouts here. Changing anything sends it back for a check.'
                      : 'Foodos checks new details before sending money to them.'}
                </Text>
                {account.accountNumberMasked ? (
                  <Text style={styles.statusText}>
                    Account {account.accountNumberMasked}
                    {account.bankName ? ` · ${account.bankName}` : ''}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <Text style={styles.intro}>
              Foodos pays restaurants by bank transfer (NEFT or RTGS) to a verified account.
            </Text>
          )}

          <Text style={styles.label}>Bank account</Text>

          <Text style={styles.subLabel}>Account holder name</Text>
          <TextInput
            style={styles.input}
            placeholder="As printed on your passbook"
            placeholderTextColor={colors.muted}
            autoCapitalize="words"
            maxLength={100}
            value={holder}
            onChangeText={setHolder}
          />

          <Text style={styles.subLabel}>Account number</Text>
          <TextInput
            style={[styles.input, number && !ACCOUNT_NUMBER_PATTERN.test(number) && styles.inputInvalid]}
            placeholder={hasSavedNumber ? `${account?.accountNumberMasked} (type to change)` : '9 to 18 digits'}
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            maxLength={18}
            value={accountNumber}
            onChangeText={text => setAccountNumber(text.replace(/\D/g, ''))}
          />

          {number ? (
            <>
              <Text style={styles.subLabel}>Confirm account number</Text>
              <TextInput
                style={[styles.input, confirm.length > 0 && confirm !== number && styles.inputInvalid]}
                placeholder="Type it again"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                maxLength={18}
                contextMenuHidden
                value={confirmNumber}
                onChangeText={text => setConfirmNumber(text.replace(/\D/g, ''))}
              />
            </>
          ) : null}

          <Text style={styles.subLabel}>IFSC</Text>
          <TextInput
            style={[styles.input, code && !IFSC_PATTERN.test(code) && styles.inputInvalid]}
            placeholder="HDFC0001234"
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={11}
            value={ifsc}
            onChangeText={text => setIfsc(text.toUpperCase().replace(/\s/g, ''))}
          />

          <Text style={styles.subLabel}>Bank name (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="HDFC Bank"
            placeholderTextColor={colors.muted}
            maxLength={100}
            value={bankName}
            onChangeText={setBankName}
          />

          {problems.length > 0 && (name || number || code) ? (
            <View style={styles.problems}>
              {problems.map(problem => (
                <Text key={problem} style={styles.problemText}>
                  {problem}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.hint}>
              Foodos pays restaurants by bank transfer (NEFT or RTGS) to a verified account. Payouts are sent by Foodos on the payout day
              and marked paid with the bank reference (UTR).
            </Text>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: space.lg + insets.bottom }]}>
          <Pressable
            style={[styles.primaryButton, (!valid || saving) && styles.disabled]}
            onPress={confirmSave}
            disabled={!valid || saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save details</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  intro: { ...type.small, color: colors.body, lineHeight: 19 },

  status: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  statusGood: { backgroundColor: colors.brandSoft },
  statusBad: { backgroundColor: colors.dangerSoft },
  statusWait: { backgroundColor: colors.warningSoft },
  statusTitle: { ...type.smallStrong },
  statusText: { ...type.caption, color: colors.body, marginTop: 2, lineHeight: 16 },

  label: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.xs },
  subLabel: { ...type.caption, color: colors.body, marginTop: space.md, marginBottom: space.xs },
  hint: { ...type.caption, color: colors.muted, marginTop: space.lg, lineHeight: 16 },

  input: {
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...type.body,
    color: colors.ink,
  },
  inputInvalid: { borderColor: colors.danger },

  problems: { marginTop: space.lg, gap: space.xs },
  problemText: { ...type.caption, color: colors.danger, lineHeight: 16 },

  footer: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    ...shadow.bar,
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { ...type.bodyStrong, color: '#fff' },
  disabled: { opacity: 0.5 },

  error: {
    marginBottom: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
