import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import {
  fetchSupportInfo,
  fetchTickets,
  policyUrl,
  STATUS_LABEL,
  type SupportInfo,
  type TicketSummary,
} from '@/lib/support'
import { colors, radius, shadow, space, type } from '@/theme'

import { Header } from '../cart'

// Answers to what customers ask most, matching how Foodos actually works.
const FAQS: { q: string; a: string }[] = [
  {
    q: 'Where is my order?',
    a: 'Open it from the bar at the bottom of Home, or from Orders. Once a delivery partner picks it up, you can follow them on the map and call them.',
  },
  {
    q: 'How do I cancel an order?',
    a: 'From the order screen, free of charge, until the restaurant accepts it. After that, raise a ticket below and we will help.',
  },
  {
    q: 'When will I get my refund?',
    a: 'Online payments go back to the original payment method. Banks usually take 5-7 working days. The order screen shows when the refund has started and when it is done.',
  },
  {
    q: 'Money was deducted but the order failed',
    a: 'If an online payment did not complete, your bank or Razorpay returns the money automatically, usually within 5-7 working days. If it does not, raise a ticket with the payment details.',
  },
  {
    q: 'Items are missing or wrong',
    a: 'Open the order and tap "Get help with this order" as soon as you can. We check with the restaurant and the delivery partner and may refund part or all of the order.',
  },
  {
    q: 'What is the delivery code?',
    a: 'A 4-digit code on your order screen. Tell it to the delivery partner only once you have your food.',
  },
  {
    q: 'How do I delete my account?',
    a: 'Profile, then Settings, then Delete my account.',
  },
]

export default function HelpScreen() {
  const router = useRouter()
  const { isSignedIn } = useAuth()

  const [info, setInfo] = useState<SupportInfo | null>(null)
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [about, mine] = await Promise.all([fetchSupportInfo(), isSignedIn ? fetchTickets() : Promise.resolve([])])

      setInfo(about)
      setTickets(mine)
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load help')
    } finally {
      setLoading(false)
    }
  }, [isSignedIn])

  // Back from a ticket: its status or a new reply shows straight away.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Header onBack={() => router.back()} title="Help & support" />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true)
              await load()
              setRefreshing(false)
            }}
            tintColor={colors.brand}
          />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Foodos</Text>
          <Text style={styles.cardHint}>
            Tell us what went wrong and we will reply here. For a problem with an order, open the order and tap
            &ldquo;Get help with this order&rdquo;.
          </Text>

          {isSignedIn ? (
            <Pressable style={styles.primary} onPress={() => router.push('/help/new')}>
              <Feather name="message-circle" size={17} color={colors.surface} />
              <Text style={styles.primaryText}>Raise a ticket</Text>
            </Pressable>
          ) : (
            <Text style={styles.cardHint}>Sign in to raise a ticket.</Text>
          )}

          {info?.supportPhone || info?.supportEmail ? (
            <View style={styles.contactRow}>
              {info.supportPhone ? (
                <Pressable style={styles.secondary} onPress={() => Linking.openURL(`tel:${info.supportPhone}`)}>
                  <Feather name="phone" size={15} color={colors.brand} />
                  <Text style={styles.secondaryText}>Call</Text>
                </Pressable>
              ) : null}
              {info.supportEmail ? (
                <Pressable style={styles.secondary} onPress={() => Linking.openURL(`mailto:${info.supportEmail}`)}>
                  <Feather name="mail" size={15} color={colors.brand} />
                  <Text style={styles.secondaryText}>Email</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {info?.supportHours ? <Text style={styles.hours}>Support hours: {info.supportHours}</Text> : null}
        </View>

        {isSignedIn ? (
          <>
            <Text style={styles.sectionTitle}>Your tickets</Text>
            {loading ? (
              <ActivityIndicator color={colors.brand} style={styles.loader} />
            ) : tickets.length === 0 ? (
              <Text style={styles.empty}>No tickets yet.</Text>
            ) : (
              <View style={styles.list}>
                {tickets.map((ticket, index) => (
                  <Pressable
                    key={ticket.id}
                    style={[styles.ticket, index > 0 && styles.divider]}
                    onPress={() => router.push({ pathname: '/help/[id]', params: { id: ticket.id } })}
                  >
                    <View style={styles.flex}>
                      <View style={styles.ticketTop}>
                        <Text style={styles.ticketSubject} numberOfLines={1}>
                          {ticket.subject}
                        </Text>
                        {ticket.awaitingYou && ticket.status !== 'closed' ? (
                          <View style={styles.newReply}>
                            <Text style={styles.newReplyText}>New reply</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.ticketMeta} numberOfLines={1}>
                        {ticket.ticketNumber}
                        {ticket.order ? ` · Order #${ticket.order.orderNumber}` : ''} · {STATUS_LABEL[ticket.status]}
                      </Text>
                      {ticket.lastMessage ? (
                        <Text style={styles.ticketLast} numberOfLines={1}>
                          {ticket.lastMessage}
                        </Text>
                      ) : null}
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Common questions</Text>
        <View style={styles.list}>
          {FAQS.map((faq, index) => {
            const open = openFaq === index

            return (
              <Pressable
                key={faq.q}
                style={[styles.faq, index > 0 && styles.divider]}
                onPress={() => setOpenFaq(open ? null : index)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
              >
                <View style={styles.faqTop}>
                  <Text style={styles.faqQ}>{faq.q}</Text>
                  <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
                </View>
                {open ? <Text style={styles.faqA}>{faq.a}</Text> : null}
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.sectionTitle}>Policies</Text>
        <View style={styles.list}>
          {(info?.policies ?? []).map((policy, index) => (
            <Pressable
              key={policy.key}
              style={[styles.policy, index > 0 && styles.divider]}
              onPress={() => WebBrowser.openBrowserAsync(policyUrl(policy.key))}
              accessibilityRole="link"
            >
              <Text style={styles.policyText}>{policy.title}</Text>
              <Feather name="external-link" size={15} color={colors.faint} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxxl },
  error: { ...type.small, color: colors.danger, marginBottom: space.md },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTitle: { ...type.heading, color: colors.ink },
  cardHint: { ...type.small, color: colors.body, marginTop: space.xs, lineHeight: 19 },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { ...type.bodyStrong, color: colors.surface },
  contactRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  secondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  secondaryText: { ...type.smallStrong, color: colors.brand },
  hours: { ...type.caption, color: colors.muted, marginTop: space.sm },

  sectionTitle: { ...type.overline, color: colors.muted, marginTop: space.xl, marginBottom: space.sm },
  loader: { marginVertical: space.lg },
  empty: { ...type.small, color: colors.muted },

  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },

  ticket: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  ticketTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ticketSubject: { ...type.bodyStrong, color: colors.ink, flexShrink: 1 },
  ticketMeta: { ...type.caption, color: colors.muted, marginTop: 2 },
  ticketLast: { ...type.small, color: colors.body, marginTop: 2 },
  newReply: { paddingHorizontal: space.sm, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: colors.brand },
  newReplyText: { ...type.caption, fontWeight: '700', color: colors.surface },

  faq: { padding: space.lg },
  faqTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  faqQ: { ...type.bodyStrong, color: colors.ink, flex: 1 },
  faqA: { ...type.small, color: colors.body, marginTop: space.sm, lineHeight: 19 },

  policy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: space.lg },
  policyText: { ...type.body, color: colors.ink },
})
