import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
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

import {
  createCategory,
  createMenuItem,
  fetchMenu,
  toPaise,
  type MenuCategory,
} from '@/lib/restaurant'
import { colors, radius, shadow, space, type } from '@/theme'

export default function AddItemScreen() {
  const router = useRouter()

  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [isVeg, setIsVeg] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [addingCategory, setAddingCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  useEffect(() => {
    fetchMenu()
      .then(menu => {
        setCategories(menu.categories)
        setCategoryId(current => current ?? menu.categories[0]?.id ?? null)
      })
      .catch(() => {
        // An item can be created without a category, so this is not fatal.
      })
  }, [])

  const paise = toPaise(price)
  const priceValid = Number.isFinite(paise) && paise > 0
  const canSave = name.trim().length > 0 && priceValid && !saving

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

    try {
      await createMenuItem({
        name: name.trim(),
        pricePaise: paise,
        categoryId,
        description: description.trim() || null,
        isVeg,
        isAvailable: true,
      })

      // The menu screen reloads when it regains focus, so the new item is there.
      router.back()
    } catch (saveError: any) {
      setError(saveError.message || 'Could not save this item')
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={8}>
          <Feather name="chevron-left" size={22} color={colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>Add a dish</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.label}>Dish name</Text>
          <TextInput
            style={styles.input}
            placeholder="Chicken Biryani"
            placeholderTextColor={colors.muted}
            value={name}
            onChangeText={setName}
            autoFocus
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
              <Text style={styles.primaryButtonText}>Add to menu</Text>
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
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
    ...type.small,
  },
})
