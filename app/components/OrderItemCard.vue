<script setup>
defineProps({
  item: { type: Object, required: true },
  index: { type: Number, required: true },
  details: { type: Array, default: () => [] },
  disabled: Boolean,
  priceAtBottom: Boolean,
})
const emit = defineEmits(['edit', 'remove', 'quantity'])
</script>

<template>
  <article class="compact-item order-edit-card" :class="{ 'price-at-bottom': priceAtBottom }">
    <div class="item-heading">
      <div class="cart-item-title">
        <strong><span class="item-bullet">{{ index + 1 }}.</span>{{ item.name }}</strong>
        <span v-if="!priceAtBottom" class="cart-item-amount">{{ (item.qty * item.price).toLocaleString() }} 元</span>
      </div>
      <div class="item-actions">
        <button type="button" class="delete-item" :disabled="disabled" :aria-label="'移除' + item.name" title="移除品項" @click="emit('remove')"><UiIcon name="trash" /></button>
        <button type="button" class="cart-item-edit" :disabled="disabled" :aria-label="'編輯' + item.name" title="編輯品項" @click="emit('edit')"><UiIcon name="edit" /></button>
      </div>
    </div>
    <div v-if="priceAtBottom && details.length" class="cart-detail-tags"><span v-for="(detail, n) in details" :key="n" class="cart-detail-tag" :class="detail.tone">{{ detail.text }}</span></div>
    <div class="quantity-line">
      <span v-if="priceAtBottom" class="cart-item-amount">{{ (item.qty * item.price).toLocaleString() }} 元</span>
      <div v-if="!priceAtBottom && details.length" class="cart-detail-tags"><span v-for="(detail, n) in details" :key="n" class="cart-detail-tag" :class="detail.tone">{{ detail.text }}</span></div>
      <div class="quantity-controls">
        <button type="button" :disabled="disabled || item.qty <= 1" :aria-label="'減少' + item.name + '數量'" @click="emit('quantity', -1)">−</button>
        <span>{{ item.qty }}</span>
        <button type="button" :disabled="disabled || item.qty >= 999" :aria-label="'增加' + item.name + '數量'" @click="emit('quantity', 1)">＋</button>
      </div>
    </div>
  </article>
</template>
