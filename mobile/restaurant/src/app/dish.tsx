import { Feather } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
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
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  createCategory,
  createMenuItem,
  deleteMenuItem,
  fetchMenu,
  pickDishPhoto,
  removeDishPhoto,
  replaceAddons,
  resolveImageUrl,
  toPaise,
  updateMenuItem,
  uploadDishPhoto,
  type MenuCategory,
  type MenuItem,
  type PhotoSource,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

// What happens to the photo when Save is pressed. Changes are staged rather
// than sent on pick, so backing out of the screen leaves the dish untouched.
type PhotoChange = { kind: 'keep' } | { kind: 'replace'; uri: string } | { kind: 'remove' }

// Prices are edited as text, so "2" and "20" are both valid mid-typing.
type AddonDraft = { key: string; name: string; price: string }

let draftKey = 0
const newDraft = (name = '', price = ''): AddonDraft => ({ key: `addon-${draftKey++}`, name, price })

function cleanAddons(drafts: AddonDraft[]) {
  return drafts
    .filter(draft => draft.name.trim() || draft.price.trim())
    .map(draft => ({ name: draft.name.trim(), pricePaise: toPaise(draft.price || '0') }))
}

export default function DishEditorScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()

  // Set once the dish exists on the server. Starts as the route's id when
  // editing; on a new dish it is filled in after the first save, so a retry
  // after a failed photo upload edits that dish instead of creating another.
  const [itemId, setItemId] = useState<string | null>(params.id ?? null)
  const isEditing = !!params.id

  const [loading, setLoading] = useState(isEditing)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [original, setOriginal] = useState<MenuItem | null>(null)

  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [isVeg, setIsVeg] = useState(true)
  const [photo, setPhoto] = useState<PhotoChange>({ kind: 'keep' })
  const [addons, setAddons] = useState<AddonDraft[]>([])
  // What the server has, to tell whether the add-ons need saving at all.
  const [savedAddons, setSavedAddons] = useState('[]')

  const [preparingPhoto, setPreparingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchMenu()
      .then(menu => {
        if (cancelled) return

        setCategories(menu.categories)

        if (params.id) {
          const dish = menu.items.find(item => item.id === params.id)

          if (!dish) {
            setError('This dish is no longer on your menu')
            return
          }

          setOriginal(dish)
          setName(dish.name)
          setDescription(dish.description ?? '')
          setPrice(String(dish.pricePaise / 100))
          setIsVeg(dish.isVeg)
          setCategoryId(dish.categoryId)

          const existing = dish.addons.map(addon => newDraft(addon.name, String(addon.pricePaise / 100)))
          setAddons(existing)
          setSavedAddons(JSON.stringify(cleanAddons(existing)))
        } else {
          setCategoryId(current => current ?? menu.categories[0]?.id ?? null)
        }
      })
      .catch(loadError => {
        // A new dish can still be created without the section list.
        if (!cancelled && params.id) setError(loadError.message || 'Could not load this dish')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [params.id])

  const paise = toPaise(price)
  const priceValid = Number.isFinite(paise) && paise > 0
  const cleanedAddons = cleanAddons(addons)
  // Every add-on that has anything typed needs both a name and a price of 0 or more.
  const addonsValid = cleanedAddons.every(
    addon => addon.name.length > 0 && Number.isFinite(addon.pricePaise) && addon.pricePaise >= 0,
  )
  const canSave = name.trim().length > 0 && priceValid && addonsValid && !saving && !preparingPhoto

  // What the photo box shows: a newly picked photo, the saved one, or nothing.
  const shownPhoto =
    photo.kind === 'replace'
      ? photo.uri
      : photo.kind === 'remove'
        ? null
        : resolveImageUrl(original?.imageUrl)

  function choosePhoto() {
    Alert.alert('Dish photo', 'Use a real photo of this dish, taken in good light.', [
      { text: 'Take photo', onPress: () => takePhoto('camera') },
      { text: 'Choose from gallery', onPress: () => takePhoto('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  async function takePhoto(source: PhotoSource) {
    setError('')
    setPreparingPhoto(true)

    try {
      const uri = await pickDishPhoto(source)

      if (uri) setPhoto({ kind: 'replace', uri })
    } catch (photoError: any) {
      setError(photoError.message || 'Could not use that photo')
    } finally {
      setPreparingPhoto(false)
    }
  }

  function removePhoto() {
    // A photo picked but not yet saved is simply dropped; a saved one is
    // marked for removal on Save.
    setPhoto(original?.imageUrl ? { kind: 'remove' } : { kind: 'keep' })
  }

  async function saveCategory() {
    const label = newCategory.trim()

    if (!label) return

    try {
      await createCategory(label)

      const menu = await fetchMenu()
      setCategories(menu.categories)
      setCategoryId(menu.categories.find(c => c.name === label)?.id ?? categoryId)
      setNewCategory('')
      setAddingCategory(false)
    } catch (categoryError: any) {
      setError(categoryError.message || 'Could not add that section')
    }
  }

  async function save() {
    if (!canSave) return

    setSaving(true)
    setError('')

    const details = {
      name: name.trim(),
      pricePaise: paise,
      categoryId,
      description: description.trim() || null,
      isVeg,
    }

    try {
      let savedId = itemId

      if (savedId) {
        await updateMenuItem(savedId, details)
      } else {
        const created = await createMenuItem({ ...details, isAvailable: true })

        savedId = created.id
        setItemId(created.id)
        setOriginal(created)
      }

      if (JSON.stringify(cleanedAddons) !== savedAddons) {
        await replaceAddons(savedId, cleanedAddons)
        setSavedAddons(JSON.stringify(cleanedAddons))
      }

      try {
        if (photo.kind === 'replace') {
          await uploadDishPhoto(savedId, photo.uri)
        } else if (photo.kind === 'remove') {
          await removeDishPhoto(savedId)
        }
      } catch (photoError: any) {
        // The dish itself is saved. Say so plainly, and stay here so Save
        // retries just the photo against the same dish.
        setError(
          `The dish was saved, but the photo did not upload: ${
            photoError.message || 'please try again'
          }`,
        )
        setSaving(false)
        return
      }

      // The menu reloads when it regains focus, so the change is there.
      router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save this dish')
      setSaving(false)
    }
  }

  function confirmDelete() {
    if (!itemId) return

    Alert.alert('Remove this dish?', `"${name}" will no longer be on your menu.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMenuItem(itemId)
            router.back()
          } catch (deleteError: any) {
            setError(deleteError.message || 'Could not remove this dish')
          }
        },
      },
    ])
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>{isEditing ? 'Edit dish' : 'Add a dish'}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={styles.photoBox}
            onPress={choosePhoto}
            disabled={preparingPhoto || saving}
          >
            {shownPhoto ? (
              <Image source={{ uri: shownPhoto }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={styles.photoEmpty}>
                <View style={styles.photoIcon}>
                  <Feather name="camera" size={22} color={colors.brand} />
                </View>
                <Text style={styles.photoTitle}>Add a photo</Text>
                <Text style={styles.photoHint}>Dishes with photos get far more orders</Text>
              </View>
            )}

            {preparingPhoto ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.photoBusyText}>Preparing photo…</Text>
              </View>
            ) : null}
          </Pressable>

          {shownPhoto ? (
            <View style={styles.photoActions}>
              <Pressable style={styles.photoAction} onPress={choosePhoto} disabled={saving}>
                <Feather name="refresh-cw" size={14} color={colors.brand} />
                <Text style={styles.photoActionText}>Change photo</Text>
              </Pressable>
              <Pressable style={styles.photoAction} onPress={removePhoto} disabled={saving}>
                <Feather name="trash-2" size={14} color={colors.danger} />
                <Text style={[styles.photoActionText, styles.photoActionDanger]}>Remove</Text>
              </Pressable>
            </View>
          ) : null}

          <Text style={styles.guideline}>
            Your own photo of the dish, plated. No people, no text, and no pictures from the
            internet.
          </Text>

          <Text style={styles.label}>Dish name</Text>
          <TextInput
            style={styles.input}
            placeholder="Chicken Biryani"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.label}>Price</Text>
          <View style={styles.priceRow}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              style={styles.priceInput}
              placeholder="249"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
              value={price}
              onChangeText={setPrice}
            />
          </View>
          {price.length > 0 && !priceValid ? (
            <Text style={styles.fieldHint}>Enter a price greater than zero.</Text>
          ) : null}

          <Text style={styles.label}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What is in it, how spicy, how big a portion…"
            placeholderTextColor={colors.muted}
            value={description}
            onChangeText={setDescription}
            multiline
          />

          <Text style={styles.label}>Food type</Text>
          <View style={styles.typeRow}>
            <Pressable
              style={[styles.typeButton, isVeg && styles.typeButtonActiveVeg]}
              onPress={() => setIsVeg(true)}
            >
              <View style={[styles.vegDot, { borderColor: colors.veg }]}>
                <View style={[styles.vegDotInner, { backgroundColor: colors.veg }]} />
              </View>
              <Text style={[styles.typeText, isVeg && styles.typeTextActive]}>Veg</Text>
            </Pressable>

            <Pressable
              style={[styles.typeButton, !isVeg && styles.typeButtonActiveNonVeg]}
              onPress={() => setIsVeg(false)}
            >
              <View style={[styles.vegDot, { borderColor: colors.nonVeg }]}>
                <View style={[styles.vegDotInner, { backgroundColor: colors.nonVeg }]} />
              </View>
              <Text style={[styles.typeText, !isVeg && styles.typeTextActive]}>Non-veg</Text>
            </Pressable>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Add-ons</Text>
            <Pressable
              onPress={() => setAddons(current => [...current, newDraft()])}
              hitSlop={8}
              disabled={addons.length >= 15}
            >
              <Text style={styles.link}>+ Add an add-on</Text>
            </Pressable>
          </View>

          {addons.length === 0 ? (
            <Text style={styles.fieldHint}>
              Optional extras customers can add, like extra raita or a soft drink.
            </Text>
          ) : null}

          {addons.map(addon => (
            <View key={addon.key} style={styles.addonRow}>
              <TextInput
                style={[styles.input, styles.addonName, styles.noMargin]}
                placeholder="Extra raita"
                placeholderTextColor={colors.muted}
                value={addon.name}
                onChangeText={text =>
                  setAddons(current => current.map(a => (a.key === addon.key ? { ...a, name: text } : a)))
                }
              />
              <View style={styles.addonPrice}>
                <Text style={styles.addonRupee}>₹</Text>
                <TextInput
                  style={styles.addonPriceInput}
                  placeholder="30"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  value={addon.price}
                  onChangeText={text =>
                    setAddons(current =>
                      current.map(a => (a.key === addon.key ? { ...a, price: text } : a)),
                    )
                  }
                />
              </View>
              <Pressable
                style={styles.addonRemove}
                onPress={() => setAddons(current => current.filter(a => a.key !== addon.key))}
                hitSlop={6}
              >
                <Feather name="x" size={16} color={colors.muted} />
              </Pressable>
            </View>
          ))}

          {!addonsValid ? (
            <Text style={styles.fieldHint}>Each add-on needs a name and a price (0 for free).</Text>
          ) : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.label}>Menu section</Text>
            <Pressable onPress={() => setAddingCategory(value => !value)} hitSlop={8}>
              <Text style={styles.link}>{addingCategory ? 'Cancel' : '+ New section'}</Text>
            </Pressable>
          </View>

          {addingCategory ? (
            <View style={styles.newCategoryRow}>
              <TextInput
                style={[styles.input, styles.flex, styles.noMargin]}
                placeholder="Starters, Breads, Desserts…"
                placeholderTextColor={colors.muted}
                value={newCategory}
                onChangeText={setNewCategory}
              />
              <Pressable
                style={[styles.smallButton, !newCategory.trim() && styles.disabled]}
                onPress={saveCategory}
                disabled={!newCategory.trim()}
              >
                <Text style={styles.smallButtonText}>Add</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.chips}>
            {categories.map(category => {
              const active = category.id === categoryId

              return (
                <Pressable
                  key={category.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setCategoryId(category.id)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {category.name}
                  </Text>
                </Pressable>
              )
            })}

            {categories.length === 0 && !addingCategory ? (
              <Text style={styles.fieldHint}>
                No sections yet. The dish will show under &quot;Other&quot;.
              </Text>
            ) : null}
          </View>

          {isEditing ? (
            <Pressable style={styles.deleteButton} onPress={confirmDelete}>
              <Feather name="trash-2" size={15} color={colors.danger} />
              <Text style={styles.deleteButtonText}>Remove from menu</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.primaryButton, !canSave && styles.disabled]}
            onPress={save}
            disabled={!canSave}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isEditing || itemId ? 'Save changes' : 'Add to menu'}
              </Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ground },
  flex: { flex: 1 },
  noMargin: { marginBottom: 0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  back: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  headerTitle: { ...type.heading, color: colors.ink },

  content: { padding: space.lg, paddingBottom: space.xxxl },

  // 4:3, the same crop the picker enforces, so what the owner sees here is
  // exactly what customers see.
  photoBox: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.lineStrong,
  },
  photo: { width: '100%', height: '100%' },
  photoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  photoIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
    marginBottom: space.xs,
  },
  photoTitle: { ...type.bodyStrong, color: colors.ink },
  photoHint: { ...type.caption, color: colors.muted },
  photoBusy: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.overlay,
  },
  photoBusyText: { ...type.smallStrong, color: '#fff' },

  photoActions: { flexDirection: 'row', gap: space.lg, marginTop: space.md },
  photoAction: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2 },
  photoActionText: { ...type.smallStrong, color: colors.brand },
  photoActionDanger: { color: colors.danger },

  guideline: { ...type.caption, color: colors.muted, marginTop: space.sm, lineHeight: 16 },

  label: { ...type.overline, color: colors.muted, marginBottom: space.sm, marginTop: space.lg },
  input: {
    padding: space.md,
    marginBottom: space.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...type.body,
    color: colors.ink,
  },
  textArea: { minHeight: 84, textAlignVertical: 'top' },
  fieldHint: { ...type.caption, color: colors.muted, marginTop: space.xs },

  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
  },
  rupee: { ...type.title, color: colors.muted },
  priceInput: { flex: 1, padding: space.md, ...type.title, color: colors.ink },

  typeRow: { flexDirection: 'row', gap: space.md },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  typeButtonActiveVeg: { borderColor: colors.veg, backgroundColor: colors.brandSoft },
  typeButtonActiveNonVeg: { borderColor: colors.nonVeg, backgroundColor: colors.dangerSoft },
  typeText: { ...type.bodyStrong, color: colors.body },
  typeTextActive: { color: colors.ink },

  vegDot: {
    width: 14,
    height: 14,
    borderWidth: 1.5,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegDotInner: { width: 6, height: 6, borderRadius: radius.pill },

  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  link: { ...type.smallStrong, color: colors.brand, marginBottom: space.sm },

  newCategoryRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },

  addonRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  addonName: { flex: 1 },
  addonPrice: {
    width: 96,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  addonRupee: { ...type.body, color: colors.muted },
  addonPriceInput: { flex: 1, paddingVertical: space.md, paddingHorizontal: space.xs, ...type.body, color: colors.ink },
  addonRemove: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ground,
  },
  smallButton: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  smallButtonText: { ...type.smallStrong, color: '#fff' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...type.small, color: colors.body },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xxl,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  deleteButtonText: { ...type.bodyStrong, color: colors.danger },

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
