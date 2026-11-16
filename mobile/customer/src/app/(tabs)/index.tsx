import { Feather } from '@expo/vector-icons'
import { Redirect, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ActiveOrderBar } from '@/components/ActiveOrderBar'
import { useAuth } from '@/lib/AuthContext'
import { useCart } from '@/lib/CartContext'
import { useLocation } from '@/lib/LocationContext'
import {
  addFavourite,
  fetchCuisines,
  fetchOffers,
  fetchPopularDishes,
  fetchRestaurants,
  removeFavourite,
  type OfferCard,
  type Restaurant,
  type RestaurantSort,
} from '@/lib/catalogue'
import { loadRecentSearches, rememberSearch } from '@/lib/recentSearches'
import { colors, radius, shadow, space, type } from '@/theme'

const CHIP_ROW_HEIGHT = 48
const ALL = '__all__'

const SORTS: { id: RestaurantSort; label: string }[] = [
  { id: 'relevance', label: 'Relevance' },
  { id: 'rating', label: 'Rating: high to low' },
  { id: 'delivery_time', label: 'Delivery time: fastest first' },
  { id: 'distance', label: 'Distance: nearest first' },
]

export default function HomeScreen() {
  const { status, isSignedIn, user } = useAuth()
  const router = useRouter()
  const cart = useCart()
  const location = useLocation()

  const [search, setSearch] = useState('')
  const [settledSearch, setSettledSearch] = useState('')
  const [cuisine, setCuisine] = useState<string | null>(null)

  // Sort and filters, like the row under the cuisines on Swiggy and Zomato.
  const [sort, setSort] = useState<RestaurantSort>('relevance')
  const [sorting, setSorting] = useState(false)
  const [vegOnly, setVegOnly] = useState(false)
  const [topRated, setTopRated] = useState(false)
  const [fastDelivery, setFastDelivery] = useState(false)

  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [cuisines, setCuisines] = useState<{ id: string; label: string; emoji: string }[]>([])
  const [offers, setOffers] = useState<OfferCard[]>([])
  const [fewRiders, setFewRiders] = useState(false)

  // Suggestions under an empty search box: this phone's recent searches and
  // what people nearby order most.
  const [searchFocused, setSearchFocused] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [popular, setPopular] = useState<string[]>([])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Searching happens on the server, so typing is debounced rather than firing
  // a request per keystroke on a mobile connection.
  useEffect(() => {
    const timer = setTimeout(() => setSettledSearch(search), 350)

    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    loadRecentSearches().then(setRecent)
  }, [])

  function searchFor(term: string) {
    setSearch(term)
    setSettledSearch(term)
    rememberSearch(term).then(setRecent)
  }

  // Restaurants are listed for the chosen address's pin, so only those that
  // deliver there show up, like Swiggy and Zomato. Without a pinned address
  // there is nothing to list yet: the screen asks for one instead.
  const point = location.point
  const needsAddress = !location.loading && !location.selected
  const needsPin = !!location.selected && !point

  const load = useCallback(async () => {
    setError('')

    if (!point) {
      setRestaurants([])
      setLoading(false)
      setRefreshing(false)
      return
    }

    try {
      const [list, cuisineList, offerList, popularList] = await Promise.all([
        fetchRestaurants({
          search: settledSearch,
          cuisine: cuisine ?? undefined,
          point,
          sort,
          vegOnly,
          minRating: topRated ? 4 : undefined,
          fastDelivery,
        }),
        fetchCuisines(point),
        fetchOffers(),
        // Suggestions are a nicety: the list still loads without them.
        fetchPopularDishes(point).catch(() => [] as string[]),
      ])

      setRestaurants(list.restaurants)
      setFewRiders(list.fewRiders)
      setCuisines(cuisineList)
      setOffers(offerList)
      setPopular(popularList)
    } catch (loadError: any) {
      setError(loadError.message || 'Could not load restaurants')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [settledSearch, cuisine, sort, vegOnly, topRated, fastDelivery, point?.latitude, point?.longitude])

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
  const filtering = vegOnly || topRated || fastDelivery || sort !== 'relevance'
  const showSuggestions = searchFocused && !search && (recent.length > 0 || popular.length > 0)

  function clearFilters() {
    setSearch('')
    setCuisine(null)
    setSort('relevance')
    setVegOnly(false)
    setTopRated(false)
    setFastDelivery(false)
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <FlatList
        data={restaurants}
        keyExtractor={item => item.id}
        showsVerticalScrollIndicator={false}
        // Taps on the suggestion chips land before the keyboard closes.
        keyboardShouldPersistTaps="handled"
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
                onFocus={() => setSearchFocused(true)}
                // A moment's delay, so tapping a suggestion still counts.
                onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
                onSubmitEditing={() => searchFor(search)}
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

            {showSuggestions && (
              <View style={styles.suggestions}>
                {recent.length > 0 && (
                  <>
                    <Text style={styles.suggestionTitle}>Recent searches</Text>
                    <View style={styles.suggestionRow}>
                      {recent.map(term => (
                        <Pressable key={term} style={styles.suggestion} onPress={() => searchFor(term)}>
                          <Feather name="clock" size={13} color={colors.muted} />
                          <Text style={styles.suggestionText}>{term}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
                {popular.length > 0 && (
                  <>
                    <Text style={styles.suggestionTitle}>Popular near you</Text>
                    <View style={styles.suggestionRow}>
                      {popular.map(term => (
                        <Pressable key={term} style={styles.suggestion} onPress={() => searchFor(term)}>
                          <Feather name="trending-up" size={13} color={colors.brand} />
                          <Text style={styles.suggestionText}>{term}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                )}
              </View>
            )}

            {fewRiders && restaurants.length > 0 && (
              <View style={styles.demandBanner}>
                <Feather name="zap" size={16} color={colors.warning} />
                <Text style={styles.demandBannerText}>
                  High demand in your area. Delivery partners are busy, so orders may take a little longer.
                </Text>
              </View>
            )}

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

            <View style={styles.chipRowWrap}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                <Pressable
                  style={[styles.chip, sort !== 'relevance' && styles.chipActive]}
                  onPress={() => setSorting(true)}
                >
                  <Text style={[styles.chipLabel, sort !== 'relevance' && styles.chipLabelActive]}>
                    {sort === 'relevance' ? 'Sort' : SORTS.find(option => option.id === sort)!.label.split(':')[0]}
                  </Text>
                  <Feather name="chevron-down" size={14} color={sort !== 'relevance' ? colors.surface : colors.body} />
                </Pressable>
                {[
                  { label: 'Pure veg', on: vegOnly, flip: () => setVegOnly(value => !value) },
                  { label: 'Rating 4.0+', on: topRated, flip: () => setTopRated(value => !value) },
                  { label: 'Fast delivery', on: fastDelivery, flip: () => setFastDelivery(value => !value) },
                ].map(filter => (
                  <Pressable
                    key={filter.label}
                    style={[styles.chip, filter.on && styles.chipActive]}
                    onPress={filter.flip}
                    accessibilityState={{ selected: filter.on }}
                  >
                    <Text style={[styles.chipLabel, filter.on && styles.chipLabelActive]}>{filter.label}</Text>
                    {filter.on && <Feather name="x" size={13} color={colors.surface} />}
                  </Pressable>
                ))}
              </ScrollView>
            </View>

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
            onPress={() => {
              // A search that led somewhere is worth suggesting again.
              if (settledSearch) rememberSearch(settledSearch).then(setRecent)
              router.push({ pathname: '/restaurant/[id]', params: { id: item.id } })
            }}
            onToggleFavourite={() => toggleFavourite(item)}
          />
        )}
        ListEmptyComponent={
          needsAddress || needsPin ? (
            <View style={styles.centeredBlock}>
              <Feather name="map-pin" size={40} color={colors.brand} />
              <Text style={styles.promptTitle}>
                {needsPin ? `Pin ${location.selected!.label} on the map` : 'Where should we deliver?'}
              </Text>
              <Text style={styles.emptyText}>
                {needsPin
                  ? 'This address was saved without a map pin. Put it on the map so we can show restaurants that deliver there.'
                  : 'Set your delivery location to see restaurants that deliver to you.'}
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() =>
                  needsPin
                    ? router.push({ pathname: '/location', params: { pin: location.selected!.id } })
                    : router.push('/location')
                }
              >
                <Text style={styles.primaryButtonText}>{needsPin ? 'Pin this address' : 'Set delivery location'}</Text>
              </Pressable>
            </View>
          ) : loading || location.loading ? (
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
                {settledSearch
                  ? `Nothing matching "${settledSearch}" near you`
                  : 'No restaurants deliver to this address yet'}
              </Text>
              {(settledSearch || cuisine || filtering) && (
                <Pressable style={styles.ghostButton} onPress={clearFilters}>
                  <Text style={styles.ghostButtonText}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          )
        }
        // Room for the live order bar and the cart bar over the end of the list.
        contentContainerStyle={[styles.listContent, { paddingBottom: cart.count > 0 ? 170 : 96 }]}
      />

      <View style={styles.bottomStack} pointerEvents="box-none">
        <ActiveOrderBar />
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
      </View>

      <Modal visible={sorting} transparent animationType="slide" onRequestClose={() => setSorting(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSorting(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Sort by</Text>
            {SORTS.map(option => {
              const chosen = option.id === sort

              return (
                <Pressable
                  key={option.id}
                  style={styles.sheetOption}
                  onPress={() => {
                    setSort(option.id)
                    setSorting(false)
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen }}
                >
                  <Text style={[styles.sheetOptionText, chosen && styles.sheetOptionChosen]}>{option.label}</Text>
                  <Feather
                    name={chosen ? 'check-circle' : 'circle'}
                    size={19}
                    color={chosen ? colors.brand : colors.lineStrong}
                  />
                </Pressable>
              )
            })}
          </Pressable>
        </Pressable>
      </Modal>
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

        {restaurant.highDemand && restaurant.isAcceptingOrders && (
          <View style={styles.demandTag}>
            <Feather name="zap" size={11} color={colors.warning} />
            <Text style={styles.demandTagText}>High demand · may take a little longer</Text>
          </View>
        )}

        <View style={styles.cardFooter}>
          <Text style={styles.cardMeta}>{restaurant.eta}</Text>
          {restaurant.distanceKm != null && (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.cardMeta}>{restaurant.distanceKm} km</Text>
            </>
          )}
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
  promptTitle: { ...type.heading, color: colors.ink, textAlign: 'center', paddingHorizontal: space.xl },
  primaryButton: {
    marginTop: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryButtonText: { ...type.bodyStrong, color: colors.surface },
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

  bottomStack: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    gap: space.sm,
  },
  cartBar: {
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

  suggestions: { marginHorizontal: space.lg, marginTop: space.md, gap: space.sm },
  suggestionTitle: { ...type.overline, color: colors.muted },
  suggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
  },
  suggestionText: { ...type.small, color: colors.ink },

  demandBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  demandBannerText: { flex: 1, ...type.small, color: colors.warning },
  demandTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: space.xs },
  demandTagText: { ...type.caption, color: colors.warning, fontWeight: '600' },

  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: {
    padding: space.lg,
    paddingBottom: space.xxl,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  sheetTitle: { ...type.heading, color: colors.ink, marginBottom: space.sm },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  sheetOptionText: { ...type.body, color: colors.body },
  sheetOptionChosen: { color: colors.ink, fontWeight: '700' },
})
