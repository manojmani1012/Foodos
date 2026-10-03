import { Feather } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { removeFavourite, type Restaurant } from '@/lib/catalogue'
import { request } from '@/lib/apiClient'
import { mapRestaurant } from '@/lib/catalogue'
import { colors, radius, shadow, space, type } from '@/theme'

async function fetchFavourites(): Promise<Restaurant[]> {
  const body = await request('/api/v1/customer/favourites')

  return body.restaurants.map(mapRestaurant)
}

export default function FavouritesScreen() {
  const router = useRouter()
  const { isSignedIn } = useAuth()

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setLoading(false)
      return
    }

    setError('')

    try {
      setRestaurants(await fetchFavourites())
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load your favourites')
    } finally {
      setLoading(false)
    }
  }, [isSignedIn])

  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  async function unfavourite(restaurant: Restaurant) {
    // Optimistic: the row leaves at once and comes back if the server refuses.
    setRestaurants(previous => previous.filter(r => r.id !== restaurant.id))

    try {
      await removeFavourite(restaurant.id)
    } catch {
      load()
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Favourites</Text>
      </View>

      <FlatList
        data={restaurants}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: item.id } })}
          >
            <View style={[styles.art, { backgroundColor: item.color }]}>
              <Text style={styles.emoji}>{item.emoji}</Text>
            </View>

            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.cuisine} numberOfLines={1}>
                {item.cuisine}
              </Text>
              <Text style={styles.meta}>
                ★ {item.rating} · {item.eta}
              </Text>
            </View>

            <Pressable onPress={() => unfavourite(item)} hitSlop={12} style={styles.heart}>
              <Feather name="heart" size={18} color={colors.nonVeg} />
            </Pressable>
          </Pressable>
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error ? (
            <View style={styles.empty}>
              <Feather name="wifi-off" size={40} color={colors.faint} />
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable style={styles.ghost} onPress={load}>
                <Text style={styles.ghostText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="heart" size={40} color={colors.faint} />
              <Text style={styles.emptyTitle}>No favourites yet</Text>
              <Text style={styles.emptyText}>
                Tap the heart on a restaurant to save it here.
              </Text>
              <Pressable style={styles.ghost} onPress={() => router.push('/')}>
                <Text style={styles.ghostText}>Browse restaurants</Text>
              </Pressable>
            </View>
          )
        }
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  headerTitle: { ...type.display, fontSize: 24, color: colors.ink },
  list: { padding: space.lg, gap: space.md, flexGrow: 1 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    ...shadow.card,
  },
  cardPressed: { opacity: 0.9 },
  art: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 30 },
  name: { ...type.bodyStrong, fontSize: 16, color: colors.ink },
  cuisine: { ...type.caption, color: colors.muted, marginTop: 2 },
  meta: { ...type.caption, color: colors.body, marginTop: space.xs },
  heart: { padding: space.sm },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  emptyTitle: { ...type.heading, color: colors.ink, marginTop: space.sm },
  emptyText: { ...type.body, color: colors.muted, textAlign: 'center' },
  ghost: {
    marginTop: space.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  ghostText: { ...type.smallStrong, color: colors.brand },
})
