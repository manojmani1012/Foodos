import { Feather } from '@expo/vector-icons'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useAuth } from '@/lib/AuthContext'
import { useCart } from '@/lib/CartContext'
import { useLocation } from '@/lib/LocationContext'
import {
  addFavourite,
  fetchCuisines,
  fetchOffers,
  fetchRestaurants,
  removeFavourite,
  type Restaurant,
} from '@/lib/catalogue'
import { colors, radius, shadow, space, type } from '@/theme'

const CHIP_ROW_HEIGHT = 48
const ALL = '__all__'

export default function HomeScreen() {
  const { status, isSignedIn, user } = useAuth()
  const router = useRouter()
  const cart = useCart()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [cuisine, setCuisine] = useState<string | null>(null)

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [cuisines, setCuisines] = useState<{ id: string; label: string; emoji: string }[]>([])
  const [offers, setOffers] = useState<any[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Searching happens on the server, so typing is debounced rather than firing
  // a request per keystroke on a mobile connection.
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), 350)

    return () => clearTimeout(timer)
  }, [search])

  const load = useCallback(async () => {
    setError('')

    try {
      const [list, cuisineList, offerList] = await Promise.all([
        fetchRestaurants({ search: settledSearch, cuisine: cuisine ?? undefined }),
        fetchCuisines(),
        fetchOffers(),
      ])

      setRestaurants(list.restaurants)
      setCuisines(cuisineList)
      setOffers(offerList)
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load restaurants')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [settledSearch, cuisine])

  useEffect(() => {
    if (isSignedIn) {
      setLoading(true)
      load()
    }
  }, [isSignedIn, load])

  if (status === 'loading') {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" color={colors.brand} />
      </SafeAreaView>
    )
  }

  if (!isSignedIn) {
    return <Redirect href="/login" />
  }

  async function toggleFavourite(restaurant: Restaurant) {
    const wasFavourite = restaurant.isFavourite

    // Optimistic, so the heart answers immediately; rolled back if the server
    // refuses.
    setRestaurants(previous =>
      previous.map(r => (r.id === restaurant.id ? { ...r, isFavourite: !wasFavourite } : r)),
    )

    try {
      await (wasFavourite ? removeFavourite(restaurant.id) : addFavourite(restaurant.id))
    } catch {
      setRestaurants(previous =>
        previous.map(r => (r.id === restaurant.id ? { ...r, isFavourite: wasFavourite } : r)),
      )
    }
  }

  const initials = (user?.fullName || user?.phone || 'U').slice(-2)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={restaurants}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              load()
            }}
            tintColor={colors.brand}
            colors={[colors.brand]}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.header}>
              <Pressable
                style={styles.locationBlock}
                onPress={() => router.push('/location')}
                hitSlop={6}
              >
                <Text style={styles.deliverLabel}>Deliver now</Text>
                <View style={styles.locationRow}>
                  <Feather name="map-pin" size={15} color={colors.brand} />
                  <Text style={styles.deliverValue} numberOfLines={1}>
                    {location.label}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.brand} />
                </View>
              </Pressable>
              <Pressable
                onPress={() => router.push('/profile')}
                hitSlop={10}
                style={styles.avatar}
              >
                <Text style={styles.avatarText}>{initials}</Text>
              </Pressable>
            </View>

            <View style={styles.searchWrap}>
              <Feather name="search" size={17} color={colors.muted} style={styles.searchIcon} />
              <TextInput
                style={styles.search}
                placeholder="Search restaurants or dishes"
                placeholderTextColor={colors.faint}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={12} style={styles.clearButton}>
                  <Feather name="x" size={13} color={colors.body} />
                </Pressable>
              )}
            </View>

            {offers.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.offerRow}
              >
                {offers.map(offer => (
                  <View key={offer.id} style={[styles.offerCard, { backgroundColor: offer.color }]}>
                    <Text style={styles.offerLabel}>{offer.label}</Text>
                    <Text style={styles.offerSub} numberOfLines={2}>
                      {offer.sub}
                    </Text>
                    <View style={styles.offerCodePill}>
                      <Text style={styles.offerCode}>{offer.code}</Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            {cuisines.length > 0 && (
              /* Fixed height: a horizontal row left to stretch turns every
                 pill-radius chip into a circle and clips its label. */
              <View style={styles.chipRowWrap}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chipRow}
                >
                  {[{ id: ALL, label: 'All', emoji: '🍽️' }, ...cuisines].map(item => {
                    const isAll = item.id === ALL
                    const active = isAll ? cuisine === null : cuisine === item.id

                    return (
                      <Pressable
                        key={item.id}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setCuisine(isAll || active ? null : item.id)}
                      >
                        <Text style={styles.chipEmoji}>{item.emoji}</Text>
                        <Text
                          style={[styles.chipLabel, active && styles.chipLabelActive]}
                          numberOfLines={1}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>
                {cuisine ? cuisine : settledSearch ? 'Results' : 'All restaurants'}
              </Text>
              {restaurants.length > 0 && (
                <Text style={styles.sectionCount}>
                  {restaurants.length} place{restaurants.length === 1 ? '' : 's'}
                </Text>
              )}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <RestaurantCard
            restaurant={item}
            onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: item.id } })}
            onToggleFavourite={() => toggleFavourite(item)}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <View style={styles.centeredBlock}>
              <ActivityIndicator color={colors.brand} />
            </View>
          ) : error ? (
            <View style={styles.centeredBlock}>
              <Feather name="wifi-off" size={40} color={colors.faint} />
              <Text style={styles.emptyText}>{error}</Text>
              <Pressable style={styles.ghostButton} onPress={load}>
                <Text style={styles.ghostButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.centeredBlock}>
              <Feather name="search" size={40} color={colors.faint} />
              <Text style={styles.emptyText}>
                {settledSearch ? `Nothing matching "${settledSearch}"` : 'No restaurants here yet'}
              </Text>
              {(settledSearch || cuisine) && (
                <Pressable
                  style={styles.ghostButton}
                  onPress={() => {
                    setSearch('')
                    setCuisine(null)
                  }}
                >
                  <Text style={styles.ghostButtonText}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          )
        }
        contentContainerStyle={[styles.listContent, cart.count > 0 && { paddingBottom: 96 }]}
      />

      {cart.count > 0 && (
        <Pressable style={styles.cartBar} onPress={() => router.push('/cart')}>
          <View style={styles.cartBadge}>
            <Text style={styles.cartBadgeText}>{cart.count}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.cartBarTitle} numberOfLines={1}>
              {cart.restaurant?.name}
            </Text>
            <Text style={styles.cartBarSub}>₹{cart.subtotal.toFixed(0)} · tap to view cart</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.surface} />
        </Pressable>
      )}
    </SafeAreaView>
  )
}

function RestaurantCard({
  restaurant,
  onPress,
  onToggleFavourite,
}: {
  restaurant: Restaurant
  onPress: () => void
  onToggleFavourite: () => void
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      android_ripple={{ color: '#00000008' }}
    >
      <View style={[styles.cardArt, { backgroundColor: restaurant.color }]}>
        <Text style={styles.cardEmoji}>{restaurant.emoji}</Text>

        <Pressable style={styles.favButton} onPress={onToggleFavourite} hitSlop={10}>
          <Feather
            name="heart"
            size={16}
            color={restaurant.isFavourite ? colors.nonVeg : colors.muted}
            // Filled when saved, outline when not.
            style={restaurant.isFavourite ? styles.favIconActive : undefined}
          />
        </Pressable>

        {!restaurant.isAcceptingOrders && (
          <View style={styles.closedOverlay}>
            <Text style={styles.closedOverlayText}>Currently closed</Text>
          </View>
        )}
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName} numberOfLines={1}>
            {restaurant.name}
          </Text>
          <View style={styles.ratingPill}>
            <Text style={styles.ratingText}>★ {restaurant.rating}</Text>
          </View>
        </View>

        <Text style={styles.cardCuisine} numberOfLines={1}>
          {restaurant.cuisine}
        </Text>

        <View style={styles.cardFooter}>
          <Text style={styles.cardMeta}>{restaurant.eta}</Text>
          <View style={styles.metaDot} />
          <Text style={styles.cardMeta}>{restaurant.delivery}</Text>
          {restaurant.isVeg && (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.vegText}>Pure veg</Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  listContent: { paddingBottom: space.xxxl },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
  // flexShrink lets the address give way to the avatar rather than overlap it.
  locationBlock: { flex: 1, flexShrink: 1, minWidth: 0 },
  deliverLabel: { ...type.overline, color: colors.muted },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 3 },
  deliverValue: { ...type.bodyStrong, fontSize: 16, color: colors.ink, flexShrink: 1 },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.surface, ...type.smallStrong },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: space.lg,
    paddingHorizontal: space.md,
    height: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    ...shadow.card,
  },
  searchIcon: { marginRight: space.sm },
  search: { flex: 1, ...type.body, color: colors.ink, padding: 0 },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.ground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearIcon: { fontSize: 12, color: colors.body, lineHeight: 15 },

  offerRow: { paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md },
  offerCard: {
    width: 200,
    minHeight: 112,
    borderRadius: radius.lg,
    padding: space.lg,
    justifyContent: 'space-between',
  },
  offerLabel: { ...type.heading, color: colors.surface, fontSize: 18 },
  offerSub: { ...type.caption, color: '#ffffffcc', marginTop: space.xs, lineHeight: 16 },
  offerCodePill: {
    alignSelf: 'flex-start',
    marginTop: space.md,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: '#ffffff26',
  },
  offerCode: { ...type.overline, color: colors.surface, letterSpacing: 1 },

  chipRowWrap: { height: CHIP_ROW_HEIGHT },
  chipRow: {
    paddingHorizontal: space.lg,
    gap: space.sm,
    alignItems: 'center',
    height: CHIP_ROW_HEIGHT,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    height: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipEmoji: { fontSize: 14 },
  chipLabel: { ...type.smallStrong, color: colors.body },
  chipLabelActive: { color: colors.surface },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  sectionTitle: { ...type.heading, fontSize: 18, color: colors.ink },
  sectionCount: { ...type.caption, color: colors.muted },

  card: {
    marginHorizontal: space.lg,
    marginBottom: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: 'hidden',
    ...shadow.card,
  },
  cardPressed: { opacity: 0.9 },
  cardArt: { height: 140, alignItems: 'center', justifyContent: 'center' },
  cardEmoji: { fontSize: 56 },
  favButton: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffffee',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  favIconActive: {},
  closedOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closedOverlayText: { ...type.smallStrong, color: colors.surface },

  cardBody: { padding: space.lg },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardName: { flex: 1, ...type.heading, color: colors.ink },
  ratingPill: {
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.brand,
  },
  ratingText: { ...type.caption, color: colors.surface, fontWeight: '700' },
  cardCuisine: { ...type.small, color: colors.muted, marginTop: space.xs },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  cardMeta: { ...type.small, color: colors.body },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.faint },
  vegText: { ...type.small, color: colors.veg, fontWeight: '600' },

  centeredBlock: { alignItems: 'center', paddingVertical: space.xxxl, gap: space.sm },
  emptyEmoji: { fontSize: 40 },
  emptyText: { ...type.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.xxl },
  ghostButton: {
    marginTop: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  ghostButtonText: { ...type.smallStrong, color: colors.brand },

  cartBar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    ...shadow.bar,
  },
  cartBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    paddingHorizontal: space.xs,
    backgroundColor: '#ffffff2e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { ...type.smallStrong, color: colors.surface },
  cartBarTitle: { ...type.bodyStrong, color: colors.surface },
  cartBarSub: { ...type.caption, color: '#ffffffcc', marginTop: 1 },
})
