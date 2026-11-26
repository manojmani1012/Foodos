import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
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

import { fetchTicket, replyToTicket, STATUS_LABEL, type Ticket } from '@/lib/support'
import { colors, radius, space, type } from '@/theme'

import { Header } from '../cart'

// While open, Foodos's reply shows up without leaving the screen.
const REFRESH_MS = 20_000

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

// One ticket as a conversation: the customer on the right, Foodos on the left.
export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setTicket(await fetchTicket(String(id)))
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load this ticket')
    }
  }, [id])

  useFocusEffect(
    useCallback(() => {
      load()
      const timer = setInterval(load, REFRESH_MS)

      return () => clearInterval(timer)
    }, [load]),
  )

  async function send() {
    if (!reply.trim() || busy) return

    setBusy(true)
    setError('')

    try {
      setTicket(await replyToTicket(String(id), reply.trim()))
      setReply('')
    } catch (sendError: any) {
      setError(sendError.message || 'Could not send your message')
    } finally {
      setBusy(false)
    }
  }

  if (!ticket) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <Header onBack={() => router.back()} title="Ticket" />
        <View style={styles.centre}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.brand} />}
        </View>
      </SafeAreaView>
    )
  }

  const closed = ticket.status === 'closed'

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onBack={() => router.back()} title={ticket.subject} subtitle={ticket.ticketNumber} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.statusRow}>
            <View style={[styles.status, ticket.status === 'resolved' || closed ? styles.statusDone : null]}>
              <Text style={[styles.statusText, ticket.status === 'resolved' || closed ? styles.statusTextDone : null]}>
                {STATUS_LABEL[ticket.status]}
              </Text>
            </View>
            {ticket.order ? (
              <Pressable
                style={styles.orderLink}
                onPress={() => router.push({ pathname: '/order/[id]', params: { id: ticket.order!.id } })}
              >
                <Text style={styles.orderLinkText}>Order #{ticket.order.orderNumber}</Text>
                <Feather name="chevron-right" size={14} color={colors.brand} />
              </Pressable>
            ) : null}
          </View>

          {ticket.messages.map(message => (
            <View key={message.id} style={[styles.bubble, message.fromSupport ? styles.theirs : styles.mine]}>
              {message.fromSupport ? <Text style={styles.author}>Foodos support</Text> : null}
              <Text style={styles.body}>{message.body}</Text>
              <Text style={styles.time}>{when(message.createdAt)}</Text>
            </View>
          ))}

          {!ticket.messages.some(message => message.fromSupport) && !closed ? (
            <Text style={styles.waiting}>Foodos will reply here. You get a notification when we do.</Text>
          ) : null}
          {ticket.status === 'resolved' ? (
            <Text style={styles.waiting}>Marked resolved. Write again if it is not, and the ticket reopens.</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {closed ? (
          <View style={styles.footer}>
            <Text style={styles.closedText}>This ticket is closed.</Text>
            <Pressable style={styles.newButton} onPress={() => router.replace('/help/new')}>
              <Text style={styles.newButtonText}>Raise a new ticket</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.footer}>
            <TextInput
              style={styles.input}
              value={reply}
              onChangeText={setReply}
              placeholder="Write a reply"
              placeholderTextColor={colors.faint}
              multiline
              maxLength={1000}
            />
            <Pressable
              style={[styles.send, (!reply.trim() || busy) && styles.disabled]}
              onPress={send}
              disabled={!reply.trim() || busy}
              accessibilityLabel="Send"
            >
              {busy ? <ActivityIndicator color={colors.surface} size="small" /> : <Feather name="send" size={18} color={colors.surface} />}
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xl },

  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.sm },
  status: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: colors.warningSoft },
  statusDone: { backgroundColor: colors.brandSoft },
  statusText: { ...type.caption, fontWeight: '700', color: colors.warning },
  statusTextDone: { color: colors.brandInk },
  orderLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  orderLinkText: { ...type.smallStrong, color: colors.brand },

  bubble: { maxWidth: '85%', padding: space.md, borderRadius: radius.lg },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brandSoft, borderBottomRightRadius: radius.sm },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderBottomLeftRadius: radius.sm,
  },
  author: { ...type.caption, fontWeight: '700', color: colors.brand, marginBottom: 2 },
  body: { ...type.body, color: colors.ink },
  time: { ...type.caption, color: colors.muted, marginTop: space.xs, textAlign: 'right' },
  waiting: { ...type.small, color: colors.muted, textAlign: 'center', marginTop: space.sm, lineHeight: 19 },
  error: { ...type.small, color: colors.danger, textAlign: 'center' },

  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    ...type.body,
    color: colors.ink,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  disabled: { opacity: 0.5 },
  closedText: { ...type.small, color: colors.muted, flex: 1, alignSelf: 'center' },
  newButton: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, backgroundColor: colors.brand },
  newButtonText: { ...type.smallStrong, color: colors.surface },
})
