import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ScreenHeader } from '@/components/ScreenHeader'
import { fetchReviews, type Review, type ReviewSummary } from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

export default function ReviewsScreen() {
  const [summary, setSummary] = useState<ReviewSummary | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const result = await fetchReviews()

      setSummary(result.summary)
      setReviews(result.reviews)
      setError('')
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your reviews')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <ScreenHeader title="Ratings and reviews" />
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScreenHeader title="Ratings and reviews" />

      <FlatList
        data={reviews}
        keyExtractor={(item, index) => `${item.orderNumber}-${index}`}
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
        ListHeaderComponent={
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {summary ? <SummaryCard summary={summary} /> : null}
            {reviews.length > 0 ? <Text style={styles.sectionTitle}>Latest reviews</Text> : null}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="star" size={24} color={colors.faint} />
            </View>
            <Text style={styles.emptyTitle}>No reviews yet</Text>
            <Text style={styles.emptyHint}>
              Customers can rate an order once it has been delivered.
            </Text>
          </View>
        }
        renderItem={({ item }) => <ReviewCard review={item} />}
      />
    </SafeAreaView>
  )
}

function SummaryCard({ summary }: { summary: ReviewSummary }) {
  // Bars are scaled to the most common rating, so the shape is readable even
  // when there are only a handful of reviews.
  const largest = Math.max(1, ...summary.distribution)

  return (
    <View style={styles.summary}>
      <View style={styles.average}>
        <Text style={styles.averageValue}>{summary.total ? summary.average.toFixed(1) : '–'}</Text>
        <Stars rating={Math.round(summary.average)} size={14} />
        <Text style={styles.averageCount}>
          {summary.total} rating{summary.total === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.bars}>
        {[5, 4, 3, 2, 1].map(stars => {
          const count = summary.distribution[stars - 1] ?? 0

          return (
            <View
              key={stars}
              style={styles.barRow}
              accessible
              accessibilityLabel={`${stars} star: ${count} rating${count === 1 ? '' : 's'}`}
            >
              <Text style={styles.barLabel}>{stars}★</Text>
              <View style={styles.barTrack}>
                {count > 0 ? (
                  <View style={[styles.barFill, { width: `${(count / largest) * 100}%` }]} />
                ) : null}
              </View>
              <Text style={styles.barCount}>{count}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function ReviewCard({ review }: { review: Review }) {
  const date = new Date(review.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Stars rating={review.rating} size={13} />
        <Text style={styles.meta}>
          {review.customerName} · #{review.orderNumber} · {date}
        </Text>
      </View>
      {review.comment ? (
        <Text style={styles.comment}>{review.comment}</Text>
      ) : (
        <Text style={styles.noComment}>Rated without a comment</Text>
      )}
    </View>
  )
}

function Stars({ rating, size }: { rating: number; size: number }) {
  return (
    <View style={styles.stars} accessibilityLabel={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(index => (
        <Text
          key={index}
          style={{ fontSize: size, color: index <= rating ? colors.star : colors.lineStrong }}
        >
          ★
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxxl, flexGrow: 1 },

  summary: {
    flexDirection: 'row',
    gap: space.xl,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  average: { alignItems: 'center', justifyContent: 'center', gap: space.xs, minWidth: 84 },
  averageValue: { ...type.display, fontSize: 36, lineHeight: 42, color: colors.ink },
  averageCount: { ...type.caption, color: colors.muted },

  bars: { flex: 1, justifyContent: 'center', gap: 6 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barLabel: { ...type.caption, color: colors.body, width: 24 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.ground, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: colors.brand },
  barCount: { ...type.caption, color: colors.muted, width: 26, textAlign: 'right' },

  sectionTitle: { ...type.overline, color: colors.muted, marginTop: space.md },

  card: {
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardTop: { gap: space.xs },
  meta: { ...type.caption, color: colors.muted },
  comment: { ...type.body, color: colors.ink, marginTop: space.sm },
  noComment: { ...type.small, color: colors.faint, marginTop: space.sm, fontStyle: 'italic' },
  stars: { flexDirection: 'row', gap: 1 },

  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxxl },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  emptyTitle: { ...type.heading, color: colors.body, marginTop: space.sm },
  emptyHint: { ...type.small, color: colors.muted, textAlign: 'center', paddingHorizontal: space.xl },

  error: {
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
