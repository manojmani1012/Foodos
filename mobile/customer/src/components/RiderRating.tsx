// "How was the delivery?": the customer rates the rider, apart from the food,
// once the order has arrived. Shown as the stars they gave once saved.

import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { reviewRider } from '@/lib/orders'
import { colors, radius, shadow, space, type } from '@/theme'

export function RiderRating({
  orderId,
  riderName,
  saved,
}: {
  orderId: string
  riderName: string
  saved: { rating: number; comment: string | null } | null
}) {
  const [review, setReview] = useState(saved)
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')

    try {
      setReview(await reviewRider(orderId, rating, comment))
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save your rating')
    } finally {
      setBusy(false)
    }
  }

  const shown = review?.rating ?? rating
  const first = riderName.split(' ')[0]

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{review ? 'Your delivery rating' : `How was the delivery by ${first}?`}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map(value => (
          <Pressable
            key={value}
            onPress={() => !review && setRating(value)}
            disabled={!!review}
            hitSlop={6}
            accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
          >
            <Feather name="star" size={28} color={value <= shown ? colors.star : colors.lineStrong} />
          </Pressable>
        ))}
      </View>

      {review ? (
        review.comment ? <Text style={styles.comment}>&ldquo;{review.comment}&rdquo;</Text> : null
      ) : (
        <>
          <TextInput
            style={styles.input}
            placeholder={`Anything to tell us about ${first}? (optional)`}
            placeholderTextColor={colors.faint}
            value={comment}
            onChangeText={setComment}
            maxLength={300}
            multiline
          />
          <Pressable
            style={[styles.button, (rating === 0 || busy) && styles.disabled]}
            disabled={rating === 0 || busy}
            onPress={submit}
          >
            {busy ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <Text style={styles.buttonText}>Rate delivery</Text>
            )}
          </Pressable>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // Matches the food rating card above it on the order screen.
  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  title: { ...type.overline, color: colors.muted, marginBottom: space.md },
  stars: { flexDirection: 'row', gap: space.sm, justifyContent: 'center', paddingVertical: space.sm },
  comment: { ...type.small, color: colors.body, textAlign: 'center' },
  input: {
    minHeight: 44,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    ...type.small,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  button: {
    marginTop: space.md,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  buttonText: { ...type.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
  error: { ...type.caption, color: colors.danger, marginTop: space.sm, textAlign: 'center' },
})
