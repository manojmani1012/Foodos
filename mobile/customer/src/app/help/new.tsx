import { Feather } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
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

import { createTicket, TOPICS } from '@/lib/support'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from '../cart'

const MAX = 1000

// "Raise a ticket": what it is about, which order (when opened from one), and
// what happened.
export default function NewTicketScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ orderId?: string; orderNumber?: string }>()

  const [orderId, setOrderId] = useState(params.orderId ?? null)
  const [topic, setTopic] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const topics = orderId ? TOPICS : TOPICS.filter(choice => !choice.needsOrder)
  const ready = !!topic && message.trim().length > 0 && !busy

  async function submit() {
    if (!ready || !topic) return

    setBusy(true)
    setError('')

    try {
      const ticket = await createTicket(topic, message.trim(), orderId)
      router.replace({ pathname: '/help/[id]', params: { id: ticket.id } })
    } catch (submitError: any) {
      setError(submitError.message || 'Could not send your message')
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onBack={() => router.back()} title="Raise a ticket" />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {orderId ? (
            <View style={styles.order}>
              <Feather name="shopping-bag" size={16} color={colors.brandInk} />
              <Text style={styles.orderText}>About order #{params.orderNumber ?? ''}</Text>
              <Pressable
                onPress={() => {
                  setOrderId(null)
                  if (TOPICS.find(choice => choice.key === topic)?.needsOrder) setTopic(null)
                }}
                hitSlop={10}
                accessibilityLabel="Not about this order"
              >
                <Feather name="x" size={16} color={colors.brandInk} />
              </Pressable>
            </View>
          ) : (
            <Text style={styles.hint}>
              For a problem with an order, open the order and tap &ldquo;Get help with this order&rdquo;, so we know
              which one.
            </Text>
          )}

          <Text style={styles.label}>What is it about?</Text>
          <View style={styles.topics}>
            {topics.map(choice => {
              const chosen = topic === choice.key

              return (
                <Pressable
                  key={choice.key}
                  style={[styles.topic, chosen && styles.topicChosen]}
                  onPress={() => setTopic(choice.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                >
                  <Text style={[styles.topicText, chosen && styles.topicTextChosen]}>{choice.label}</Text>
                </Pressable>
              )
            })}
          </View>

          <Text style={styles.label}>What happened?</Text>
          <TextInput
            style={styles.input}
            value={message}
            onChangeText={setMessage}
            placeholder="Tell us in a few words, for example which item was missing"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={MAX}
          />
          <Text style={styles.count}>
            {message.length}/{MAX}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={[styles.submit, !ready && styles.disabled]} onPress={submit} disabled={!ready}>
            {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.submitText}>Send to Foodos</Text>}
          </Pressable>
          <Text style={styles.hint}>Foodos replies here, and you get a notification when we do.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxxl },

  order: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  orderText: { ...type.smallStrong, color: colors.brandInk, flex: 1 },
  hint: { ...type.small, color: colors.muted, marginTop: space.sm, lineHeight: 19 },

  label: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  topic: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  topicChosen: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  topicText: { ...type.small, color: colors.body },
  topicTextChosen: { color: colors.brandInk, fontWeight: '600' },

  input: {
    minHeight: 120,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    ...type.body,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  count: { ...type.caption, color: colors.faint, textAlign: 'right', marginTop: space.xs },
  error: { ...type.small, color: colors.danger, marginTop: space.sm },

  submit: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: space.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    ...shadow.card,
  },
  submitText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
})
