// Under a delivered order: asking Foodos to refund part of it for a food
// problem, with photos. Foodos staff check them before any money moves.

import { Feather } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import {
  fetchOrderRefunds,
  formatRupees,
  pickDishPhoto,
  requestRefund,
  uploadRefundPhoto,
  type OrderRefunds,
  type PhotoSource,
  type RefundRequest,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

const MAX_PHOTOS = 5

export function FoodRefund({ orderId }: { orderId: string }) {
  const [data, setData] = useState<OrderRefunds | null>(null)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  // Photos on the phone; `id` once uploaded, so a retry does not send it twice.
  const [photos, setPhotos] = useState<{ uri: string; id?: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetchOrderRefunds(orderId)
      .then(setData)
      // An older server has no such call; the order still shows.
      .catch(() => setData(null))
  }, [orderId])

  useEffect(load, [load])

  if (!data || (!data.canRequest && data.requests.length === 0)) return null

  const paise = Math.round(Number(amount.replace(/,/g, '')) * 100)
  const amountOk = Number.isFinite(paise) && paise > 0 && paise <= data.refundablePaise
  const ready = amountOk && reason.trim().length >= 5 && photos.length > 0

  async function addPhoto(source: PhotoSource) {
    setError('')

    try {
      const uri = await pickDishPhoto(source, null)
      if (uri) setPhotos(current => [...current, { uri }].slice(0, MAX_PHOTOS))
    } catch (photoError: any) {
      setError(photoError.message || 'Could not add the photo')
    }
  }

  async function send() {
    setBusy(true)
    setError('')

    try {
      const uploaded = [...photos]

      for (let index = 0; index < uploaded.length; index += 1) {
        if (!uploaded[index].id) {
          uploaded[index] = { ...uploaded[index], id: await uploadRefundPhoto(orderId, uploaded[index].uri) }
          setPhotos([...uploaded])
        }
      }

      setData(await requestRefund(orderId, paise, reason.trim(), uploaded.map(photo => photo.id!)))
      setOpen(false)
      setAmount('')
      setReason('')
      setPhotos([])
    } catch (sendError: any) {
      setError(sendError.message || 'Could not send the request')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Refund for a food problem</Text>

      {data.requests.map(request => (
        <RequestLine key={request.id} request={request} />
      ))}

      {data.canRequest && !open ? (
        <Pressable style={styles.ghost} onPress={() => setOpen(true)} accessibilityRole="button">
          <Text style={styles.ghostText}>Ask to refund part of this order</Text>
        </Pressable>
      ) : null}

      {data.canRequest && open ? (
        <View style={styles.form}>
          <Text style={styles.hint}>
            Foodos checks your photos first. If approved, the customer is refunded and the amount comes off your next
            payout.
          </Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            placeholder={`Amount, up to ${formatRupees(data.refundablePaise)}`}
            placeholderTextColor={colors.muted}
            accessibilityLabel="Refund amount in rupees"
          />
          <TextInput
            style={[styles.input, styles.multi]}
            value={reason}
            onChangeText={setReason}
            placeholder="What went wrong? The customer sees this."
            placeholderTextColor={colors.muted}
            maxLength={200}
            multiline
            accessibilityLabel="What went wrong"
          />

          <View style={styles.photos}>
            {photos.map((photo, index) => (
              <Pressable
                key={photo.uri}
                onPress={() => setPhotos(current => current.filter((_, i) => i !== index))}
                accessibilityLabel={`Remove photo ${index + 1}`}
              >
                <Image source={{ uri: photo.uri }} style={styles.thumb} />
                <View style={styles.remove}>
                  <Feather name="x" size={12} color="#fff" />
                </View>
              </Pressable>
            ))}
          </View>
          {photos.length < MAX_PHOTOS ? (
            <View style={styles.row}>
              <Pressable style={[styles.ghost, styles.flex]} onPress={() => addPhoto('camera')}>
                <Text style={styles.ghostText}>Take photo</Text>
              </Pressable>
              <Pressable style={[styles.ghost, styles.flex]} onPress={() => addPhoto('library')}>
                <Text style={styles.ghostText}>Choose photo</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            style={[styles.button, (!ready || busy) && styles.disabled]}
            disabled={!ready || busy}
            onPress={send}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text style={styles.buttonText}>Send to Foodos</Text>
            )}
          </Pressable>
          {!ready ? <Text style={styles.hint}>Add the amount, what went wrong and at least one photo.</Text> : null}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

function RequestLine({ request }: { request: RefundRequest }) {
  const status =
    request.status === 'pending'
      ? 'Foodos is checking it'
      : request.status === 'approved'
        ? `Approved: ${formatRupees(request.refundedPaise ?? request.amountPaise)} refunded`
        : `Not approved${request.rejectReason ? `: ${request.rejectReason}` : ''}`

  return (
    <View style={styles.request}>
      <Text style={styles.requestTitle}>
        {formatRupees(request.amountPaise)} · {request.reason}
      </Text>
      <Text style={styles.hint}>{status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { padding: space.lg, gap: space.sm, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  title: { ...type.bodyStrong, color: colors.ink },
  form: { gap: space.sm },
  hint: { ...type.caption, color: colors.muted, lineHeight: 17 },
  error: { ...type.small, color: colors.danger },
  input: {
    ...type.body,
    color: colors.ink,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
  },
  multi: { minHeight: 70, textAlignVertical: 'top' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  thumb: { width: 68, height: 68, borderRadius: radius.md },
  remove: {
    position: 'absolute',
    top: 2,
    right: 2,
    padding: 2,
    borderRadius: 999,
    backgroundColor: colors.danger,
  },
  row: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  ghost: {
    alignItems: 'center',
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.md,
  },
  ghostText: { ...type.smallStrong, color: colors.brand },
  button: { alignItems: 'center', paddingVertical: space.md, borderRadius: radius.md, backgroundColor: colors.brand },
  buttonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
  request: { gap: 2 },
  requestTitle: { ...type.smallStrong, color: colors.ink },
})
