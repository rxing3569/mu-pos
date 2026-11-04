<script setup>
import {
  localRead,
  localChange,
  saveLocal,
  taipeiDay,
  pruneBackedUp,
} from "~/utils/local-orders.mjs";
import { dayKey, dailyRevenue, itemCount } from "~/utils/dashboard.mjs";
import { requestAppsScript, listAppsScript } from "~/utils/apps-script.mjs";
import { reconcileMenuIds } from "~/utils/menu-ids.mjs";
import { makeDemoOrders, normalizeDemoOrder } from "~/utils/demo-orders.mjs";
import { normalizedPath } from "~/utils/route-path.mjs";
import { fetchCloudMonth } from "~/utils/cloud-month.mjs";
import uploadIcon from "~/assets/icons/upload.svg?url";
import backupIcon from "~/assets/icons/backup.svg?url";
const isDev = import.meta.dev;
const router = useRouter(),
  route = useRoute(),
  cart = ref([]),
  orders = ref([]),
  table = ref("1"),
  kind = ref("內用"),
  message = ref(""),
  busy = ref(false),
  orderNote = ref("");
function isPage(path) {
  return normalizedPath(route.path) === path;
}
const accessKey = useState("pos-access-key", () => ""),
  connected = useState("pos-connected", () => false);
const online = ref(true),
  lastBackup = ref("");
function updateOnline() {
  online.value = navigator.onLine;
}
onMounted(() => {
  online.value = navigator.onLine;
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  accessKey.value = localStorage.getItem("mu-pos-access-key") || "";
  connected.value = !!accessKey.value;
  if (!accessKey.value) nextTick(() => connectDialog.value?.showModal());
});
onBeforeUnmount(() => {
  window.removeEventListener("online", updateOnline);
  window.removeEventListener("offline", updateOnline);
});
const backupTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function backupTime(value) {
  return value ? backupTimeFormatter.format(new Date(value)) : "尚未備份";
}
const connectDialog = ref(null),
  keyInput = ref(""),
  connectError = ref(""),
  connecting = ref(false),
  resumeMenuSave = ref(false),
  resumeMenuForce = ref(false),
  resumeSync = ref(false);
const backupOverlayDialog = ref(null),
  syncingBackup = ref(false),
  syncCompleted = ref(0),
  syncTotal = ref(0),
  syncError = ref("");
onMounted(() => {
  syncError.value = sessionStorage.getItem("mu-last-sync-error") || "";
});
function recordSyncError(error) {
  syncError.value = error;
  sessionStorage.setItem("mu-last-sync-error", error);
  showSnackbar(error);
}
watch(syncingBackup, async (active) => {
  await nextTick();
  if (active && !backupOverlayDialog.value?.open)
    backupOverlayDialog.value?.showModal();
  if (!active && backupOverlayDialog.value?.open)
    backupOverlayDialog.value.close();
});
function requireAccess(message = "") {
  accessKey.value = "";
  connected.value = false;
  localStorage.removeItem("mu-pos-access-key");
  connectError.value = message;
  if (!connectDialog.value?.open) connectDialog.value?.showModal();
}
function cancelConnect() {
  keyInput.value = "";
  connectDialog.value?.close();
  resumeMenuSave.value = false;
  resumeMenuForce.value = false;
  resumeSync.value = false;
}
const pendingCheckout = ref(null);
const saving = ref(false);
const writable = computed(() => !saving.value && !pendingCheckout.value);
const cloudOrders = useState("pos-cloud-orders", () => []);
watch(
  cloudOrders,
  (v) => {
    orders.value = v;
  },
  { immediate: true },
);

const snackbar = ref("");
let snackbarTimer;
function showSnackbar(text) {
  clearTimeout(snackbarTimer);
  snackbar.value = text;
  snackbarTimer = setTimeout(() => {
    snackbar.value = "";
  }, 3000);
}
onBeforeUnmount(() => clearTimeout(snackbarTimer));
const groups = reactive([]);

const loyaltyDiscount = ref(0),
  loyaltyDraft = ref("0"),
  loyaltyError = ref(""),
  loyaltyDialog = ref(null);
function openLoyaltyDialog() {
  loyaltyDraft.value = String(loyaltyDiscount.value);
  loyaltyError.value = "";
  loyaltyDialog.value.showModal();
}
function saveLoyalty() {
  const n = Number(loyaltyDraft.value);
  if (
    !/^\d+$/.test(loyaltyDraft.value) ||
    !Number.isSafeInteger(n) ||
    n < 1 ||
    n > 10000000
  ) {
    loyaltyError.value = "請輸入大於 0 的整數";
    return;
  }
  loyaltyDiscount.value = n;
  markMenuDraft();
  loyaltyDialog.value.close();
  showSnackbar("優惠金額已修改，請儲存菜單");
}
function reprice(i) {
  i.price = Math.max(
    0,
    (i.basePrice ?? i.price) -
      (i.loyaltyApplied ? (i.loyaltyAmount ?? loyaltyDiscount.value) : 0),
  );
}
function toggleLoyalty(i) {
  i.basePrice ??= i.price;
  i.loyaltyApplied = !i.loyaltyApplied;
  i.loyaltyAmount = i.loyaltyApplied ? loyaltyDiscount.value : 0;
  reprice(i);
}
const mealDrinks = ["紅茶", "綠茶", "奶茶", "咖啡"];
function mealReady(i) {
  return i.group !== "主餐" || !!(i.mealDrink?.name && i.mealDrink?.variant);
}
function setMealDrink(i, name) {
  i.mealDrink = {
    name,
    variant: i.mealDrink?.variant || "",
    sweetness: "正常",
    ice: "正常",
    heat: "熱",
  };
}
const menu = reactive([]);
const selectedSettingsCategory = ref("");
const menuSaveConfirmDialog = ref(null);
async function confirmMenuSave() {
  if (await saveMenuDraft()) menuSaveConfirmDialog.value?.close();
}
let menuIdCounters = {};
function updateMenuIds() {
  const result = reconcileMenuIds(menu, groups, menuIdCounters);
  menuIdCounters = result.counters;
  return result.changed;
}
const menuReady = ref(false);
const menuDraftDirty = ref(false),
  menuSaving = ref(false),
  menuSaveError = ref(""),
  leaveMenuDialog = ref(null),
  uploadDialog = ref(null);
watch(menuSaving, async (value) => {
  await nextTick();
  if (value && !uploadDialog.value?.open) uploadDialog.value?.showModal();
  if (!value && uploadDialog.value?.open) uploadDialog.value.close();
});
let committedMenu = null,
  committedGroups = null,
  committedLoyalty = 0,
  committedMenuIdCounters = {},
  pendingLeave = null;
function snapshotMenu() {
  committedMenu = JSON.parse(JSON.stringify(menu));
  committedGroups = JSON.parse(JSON.stringify(groups));
  committedLoyalty = loyaltyDiscount.value;
  committedMenuIdCounters = { ...menuIdCounters };
  menuDraftDirty.value = false;
}
function markMenuDraft() {
  menuDraftDirty.value = true;
}
function discardMenuDraft() {
  if (committedMenu) {
    menu.splice(0, menu.length, ...JSON.parse(JSON.stringify(committedMenu)));
    groups.splice(
      0,
      groups.length,
      ...JSON.parse(JSON.stringify(committedGroups)),
    );
    loyaltyDiscount.value = committedLoyalty;
    menuIdCounters = { ...committedMenuIdCounters };
    selectedSettingsCategory.value = groups[0]?.[0] || "";
  }
  menuDraftDirty.value = false;
}
function cloudMenuData() {
  return [
    ...groups.map((g) => ({
      type: "分類",
      key: g[0],
      group: g[0],
      name: g[0],
      price: 0,
      nextItemNo: menuIdCounters[g[0]] || 0,
    })),
    {
      type: "設定",
      key: "熟客券優惠",
      group: "系統設定",
      name: "熟客券優惠",
      price: loyaltyDiscount.value,
      options: [],
    },
    ...JSON.parse(
      JSON.stringify(
        menu.map((item) => ({
          type: "品項",
          key: item.id,
          group: item.group,
          name: item.name,
          price: item.price,
          options: menuOptions(item),
        })),
      ),
    ),
  ];
}
async function persistLocalMenu() {
  const menuData = {
    items: JSON.parse(JSON.stringify(menu)),
    categories: groups.map((g) => ({ name: g[0], id: g[2] })),
    loyaltyDiscount: loyaltyDiscount.value,
    idCounters: { ...menuIdCounters },
  };
  await localChange((state) => { state.menuData = menuData; });
}
async function saveMenuDraft(force = false) {
  if ((!menuDraftDirty.value && !force) || menuSaving.value) return true;
  if (!online.value) {
    menuSaveError.value = "目前離線，連線後再儲存菜單";
    showSnackbar(menuSaveError.value);
    return false;
  }
  if (!accessKey.value) {
    menuSaveError.value = "";
    connectError.value = "";
    resumeMenuSave.value = true;
    resumeMenuForce.value = force;
    if (!connectDialog.value?.open) connectDialog.value?.showModal();
    return false;
  }
  menuSaving.value = true;
  menuSaveError.value = "";
  try {
    await requestAppsScript(accessKey.value, {
      action: "menuSave",
      data: cloudMenuData(),
    });
    await persistLocalMenu();
    snapshotMenu();
    showSnackbar("菜單已儲存並同步");
    return true;
  } catch (error) {
    if (error.code === "UNAUTHORIZED") {
      resumeMenuSave.value = true;
      requireAccess("存取密碼已失效，請重新輸入");
    } else menuSaveError.value = "儲存失敗：" + error.message;
    showSnackbar(menuSaveError.value || "請重新輸入存取密碼");
    return false;
  } finally {
    menuSaving.value = false;
  }
}
function beforePageUnload(event) {
  if (!menuDraftDirty.value) return;
  event.preventDefault();
  event.returnValue = "";
}
onMounted(() => window.addEventListener("beforeunload", beforePageUnload));
onBeforeUnmount(() =>
  window.removeEventListener("beforeunload", beforePageUnload),
);
const removeMenuGuard = router.beforeEach((to, from) => {
  if (
    normalizedPath(from.path) !== "/settings" ||
    normalizedPath(to.path) === "/settings" ||
    !menuDraftDirty.value
  )
    return true;
  return new Promise((resolve) => {
    pendingLeave = resolve;
    leaveMenuDialog.value?.showModal();
  });
});
onBeforeUnmount(() => {
  removeMenuGuard();
  pendingLeave?.(false);
});
async function finishLeave(choice) {
  if (choice === "save" && !(await saveMenuDraft())) return;
  if (choice === "discard") discardMenuDraft();
  leaveMenuDialog.value?.close();
  pendingLeave?.(choice !== "cancel");
  pendingLeave = null;
}

const visibleSettingsItems = computed(() =>
  menu.filter((item) => item.group === selectedSettingsCategory.value),
);
const categoryDialog = ref(null),
  categoryDraft = ref(""),
  categoryError = ref(""),
  editingCategory = ref(null);
const itemDialog = ref(null),
  itemDraft = ref(null),
  itemError = ref(""),
  editingItemId = ref(null);
const itemCategoryPicker = ref(null),
  itemCategoryOpen = ref(false);
function closeItemCategoryOutside(event) {
  if (
    itemCategoryOpen.value &&
    !itemCategoryPicker.value?.contains(event.target)
  )
    itemCategoryOpen.value = false;
}
onMounted(() =>
  document.addEventListener("pointerdown", closeItemCategoryOutside),
);
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", closeItemCategoryOutside),
);
function chooseItemCategory(name) {
  itemDraft.value.group = name;
  itemCategoryOpen.value = false;
}
const mobileOrderOpen = ref(false);
function closeMobileOrderOnEscape(event) {
  if (event.key === "Escape") mobileOrderOpen.value = false;
}
onMounted(() => window.addEventListener("keydown", closeMobileOrderOnEscape));
onBeforeUnmount(() =>
  window.removeEventListener("keydown", closeMobileOrderOnEscape),
);
const storageUsage = ref("計算中…");
const menuRestoreDialog = ref(null);
const menuDownloading = ref(false);
async function restoreMenuFromCloud() {
  if (menuDownloading.value) return;
  menuDownloading.value = true;
  try {
    const result = await requestAppsScript(accessKey.value, {
      action: "menuGet",
    });
    if (!Array.isArray(result.data)) throw Error("雲端菜單資料格式不符");
    const categories = result.data
      .filter((item) => item.type === "分類" && item.key !== "減項")
      .map((item) => ({ name: item.key, id: item.key, nextItemNo: item.nextItemNo }));
    const config = result.data.find((item) => item.type === "設定" && item.key === "熟客券優惠");
    loyaltyDiscount.value = config ? Number(config.price) || 0 : 0;
    const items = result.data
      .filter((item) => item.type === "品項" && item.group !== "減項")
      .map(({ type, key, sort, updatedAt, nextItemNo, ...item }) => ({ ...item, id: key }));
    menu.splice(0, menu.length, ...items);
    groups.splice(
      0,
      groups.length,
      ...(categories.length
        ? categories.map((category) => [category.name, "", category.id])
        : [...new Set(items.map((item) => item.group))].map((name) => [
            name,
            "",
            crypto.randomUUID(),
          ])),
    );
    groups.splice(0, groups.length, ...groups.filter((g) => g[0] !== "減項"));
    menu.splice(0, menu.length, ...menu.filter((i) => i.group !== "減項"));
    menuIdCounters = Object.fromEntries(
      categories.map((category) => [
        category.name,
        Number(
          category.nextItemNo,
        ) || 0,
      ]),
    );
    updateMenuIds();
    selectedSettingsCategory.value = groups[0]?.[0] || "";
    await persistLocalMenu();
    snapshotMenu();
    menuRestoreDialog.value.close();
    showSnackbar(items.length ? "雲端菜單已下載到本機" : "雲端菜單目前為空，本機菜單已清空");
  } catch (error) {
    showSnackbar(error.code === "SCHEMA_MISMATCH"
      ? "雲端「菜單」工作表欄位與目前版本不符，請檢查表頭"
      : error.message);
  } finally {
    menuDownloading.value = false;
  }
}
async function inspectStorage() {
  if (!navigator.storage?.estimate) {
    storageUsage.value = "此瀏覽器無法提供用量";
    return;
  }
  const { usage, quota } = await navigator.storage.estimate();
  storageUsage.value = `${((usage || 0) / 1048576).toFixed(1)}／${((quota || 0) / 1048576).toFixed(0)} (MB)`;
}
onMounted(async () => {
  try {
    const saved = (await localRead()).menuData;
    if (saved && Array.isArray(saved.items)) {
      menu.splice(0, menu.length, ...saved.items);
      const categories = Array.isArray(saved.categories) ? saved.categories : [];
      const names = categories.length
        ? categories.map((entry) => entry.name)
        : [...new Set(saved.items.map((item) => item.group))];
      groups.splice(0, groups.length, ...names.filter(Boolean).map((name) => [
        name, "", categories.find((entry) => entry.name === name)?.id || crypto.randomUUID(),
      ]));
      loyaltyDiscount.value = Number(saved.loyaltyDiscount) || 0;
      menuIdCounters = saved.idCounters || {};
      let migrated = false;
      menu.forEach((item) => {
        if ("active" in item) { delete item.active; migrated = true; }
        if (!item.options) { item.options = menuOptions(item); migrated = true; }
      });
      if (updateMenuIds()) migrated = true;
      if (migrated) await persistLocalMenu();
    }
    for (const key of ["mu-menu", "mu-categories", "mu-loyalty-discount", "mu-menu-id-counters", "mu-menu-dirty"])
      localStorage.removeItem(key);
    selectedSettingsCategory.value = groups[0]?.[0] || "";
    snapshotMenu();
  } catch (error) {
    showSnackbar("讀取菜單失敗：" + error.message);
  } finally {
    menuReady.value = true;
  }
  watch(
    menu,
    () => {
      if (isPage("/settings")) markMenuDraft();
    },
    { deep: true, flush: "sync" },
  );
});
function persistCategories() {
  markMenuDraft();
}
function openCategoryDialog(group = null) {
  editingCategory.value = group;
  categoryDraft.value = group?.[0] || "";
  categoryError.value = "";
  categoryDialog.value.showModal();
}
function saveCategory() {
  const name = categoryDraft.value.trim();
  if (!name) {
    categoryError.value = "請輸入分類名稱";
    return;
  }
  if (
    groups.some((group) => group[0] === name && group !== editingCategory.value)
  ) {
    categoryError.value = "分類名稱已存在";
    return;
  }
  if (editingCategory.value) {
    const old = editingCategory.value[0];
    editingCategory.value[0] = name;
    menu.forEach((item) => {
      if (item.group === old) {
        item.group = name;
        item.id = name + item.id.slice(old.length);
      }
    });
    menuIdCounters[name] = menuIdCounters[old] || 0;
    delete menuIdCounters[old];
    updateMenuIds();
    selectedSettingsCategory.value = name;
  } else {
    groups.push([name, "", crypto.randomUUID()]);
    selectedSettingsCategory.value = name;
  }
  persistCategories();
  categoryDialog.value.close();
}
function removeCategory(group) {
  if (menu.some((item) => item.group === group[0])) {
    categoryError.value = "請先移動此分類的品項";
    return;
  }
  const index = groups.indexOf(group);
  groups.splice(index, 1);
  selectedSettingsCategory.value = groups[Math.max(0, index - 1)]?.[0] || "";
  persistCategories();
  categoryDialog.value.close();
}
function menuOptions(item) {
  if (item.options) return item.options;
  const price = item.price;
  const cold = { value: "冰杯", price },
    hot = {
      value: item.group === "茶" || item.group === "香濃奶茶" ? "熱壺" : "熱杯",
      price: item.group === "茶" || item.group === "香濃奶茶" ? 150 : price,
    };
  if (item.group === "茶" || item.group === "香濃奶茶")
    return item.name === "冰淇淋奶茶" ? [cold] : [cold, hot];
  if (item.group === "義式咖啡")
    return item.name.startsWith("冰") ? [cold] : [cold, hot];
  if (item.group === "花草茶") return [{ value: "熱壺", price }];
  if (item.group === "冰沙") return [cold];
  return [];
}
function openItemDialog(item = null) {
  editingItemId.value = item?.id || null;
  itemDraft.value = item
    ? JSON.parse(JSON.stringify(item))
    : {
        id: "",
        group: selectedSettingsCategory.value,
        name: "",
        price: 0,
        options: [],
      };
  itemDraft.value.options = JSON.parse(
    JSON.stringify(menuOptions(itemDraft.value)),
  );
  itemError.value = "";
  itemCategoryOpen.value = false;
  itemDialog.value.showModal();
}
function setItemMode(mode) {
  const item = itemDraft.value;
  if (!item) return;
  const current = item.options || [];
  const cold = current.find((option) => option.value.startsWith("冰")) || {
    value: "冰杯",
    price: item.price || 0,
  };
  const hot = current.find((option) => option.value.startsWith("熱")) || {
    value: ["茶", "香濃奶茶", "花草茶"].includes(item.group) ? "熱壺" : "熱杯",
    price: item.price || 0,
  };
  item.options =
    mode === "無冷熱"
      ? []
      : mode === "僅冰"
        ? [cold]
        : mode === "僅熱"
          ? [hot]
          : [cold, hot];
}
function itemMode(item) {
  const options = item?.options || [];
  const cold = options.some((option) => option.value.startsWith("冰")),
    hot = options.some((option) => option.value.startsWith("熱"));
  return cold && hot ? "冰熱都有" : cold ? "僅冰" : hot ? "僅熱" : "無冷熱";
}
function saveItemDraft() {
  const item = itemDraft.value;
  if (!item?.name.trim()) {
    itemError.value = "請輸入品項名稱";
    return;
  }
  if (!groups.some((group) => group[0] === item.group)) {
    itemError.value = "請選擇分類";
    return;
  }
  const validPrice = (price) =>
    Number.isSafeInteger(price) && price > 0 && price <= 10000000;
  if (
    !(item.options.length
      ? item.options.every((option) => validPrice(option.price))
      : validPrice(item.price))
  ) {
    itemError.value = "價格須為大於 0 的整數";
    return;
  }
  item.price = item.options[0]?.price ?? item.price;
  if (
    editingItemId.value &&
    menu.find((row) => row.id === editingItemId.value)?.group !== item.group
  )
    item.id = "";
  const index = menu.findIndex((row) => row.id === editingItemId.value);
  if (index >= 0) menu.splice(index, 1, item);
  else menu.push(item);
  updateMenuIds();
  markMenuDraft();
  selectedSettingsCategory.value = item.group;
  itemDialog.value.close();
}
const itemDeleteDialog = ref(null);
const itemDeleteTarget = ref(null);
function openRemoveItem(item) {
  itemDeleteTarget.value = item;
  itemDeleteDialog.value.showModal();
}
function confirmRemoveItem() {
  const index = menu.findIndex((item) => item.id === itemDeleteTarget.value?.id);
  if (index < 0) return;
  menu.splice(index, 1);
  markMenuDraft();
  itemDeleteDialog.value.close();
  itemDeleteTarget.value = null;
}
const dragging = ref(null),
  dropTarget = ref(null);
function startSort(event, type, id) {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = { type, id, pointerId: event.pointerId };
  dropTarget.value = null;
  event.currentTarget.setPointerCapture(event.pointerId);
}
function hoverSort(event) {
  if (!dragging.value) return;
  const row = document
    .elementFromPoint(event.clientX, event.clientY)
    ?.closest("[data-sort-type]");
  dropTarget.value =
    row?.dataset.sortType === dragging.value.type &&
    row.dataset.sortId !== dragging.value.id
      ? row.dataset.sortId
      : null;
}
function finishSort(event) {
  if (!dragging.value) return;
  hoverSort(event);
  const { type, id } = dragging.value,
    target = dropTarget.value;
  dragging.value = null;
  dropTarget.value = null;
  if (!target) return;
  if (type === "category") {
    const from = groups.findIndex((g) => g[2] === id),
      to = groups.findIndex((g) => g[2] === target);
    if (from < 0 || to < 0) return;
    groups.splice(to, 0, groups.splice(from, 1)[0]);
    persistCategories();
  } else {
    const from = menu.findIndex((i) => i.id === id),
      to = menu.findIndex((i) => i.id === target);
    if (from < 0 || to < 0) return;
    menu.splice(to, 0, menu.splice(from, 1)[0]);
  }
}
function cancelSort() {
  dragging.value = null;
  dropTarget.value = null;
}
const total = computed(() =>
    cart.value.reduce((a, i) => a + i.price * i.qty, 0),
  ),
  net = computed(() => orders.value.reduce((a, o) => a + o.total, 0));
const money = (n) => n.toLocaleString() + " 元";
onMounted(() => {
  for (const [k, r] of Object.entries({ cart, orderNote, pendingCheckout })) {
    try {
      const v = localStorage.getItem("mu-" + k);
      if (v) r.value = JSON.parse(v);
    } catch {}
    watch(r, (v) => localStorage.setItem("mu-" + k, JSON.stringify(v)), {
      deep: true,
    });
  }
});
function variants(p) {
  const base = menu.find((item) => item.id === p.id) || p;
  return menuOptions(base).map((option) => ({
    label:
      option.value === "熱壺"
        ? "熱（壺）"
        : option.value === "冰杯" &&
            (base.group === "茶" || base.group === "香濃奶茶")
          ? "冰（杯）"
          : option.value.startsWith("冰")
            ? "冰"
            : "熱",
    value: option.value,
    price: option.price,
  }));
}
const tableDialog = ref(null);
const tableChoices = [
  "外帶",
  "A1",
  "A2",
  "B1",
  "B2",
  "B3",
  "B4",
  ...Array.from({ length: 10 }, (_, i) => String(i + 1)),
];
function chooseTable(value) {
  kind.value = value === "外帶" ? "外帶" : "內用";
  table.value = value === "外帶" ? "" : value;
  tableDialog.value.close();
}
function normalizeItem(i) {
  i.variant ??= "";
  i.sweetness ??= "正常";
  i.ice ??= i.variant?.startsWith("冰") ? "正常" : "";
  i.heat ??= i.variant?.startsWith("熱") ? "熱" : "";
  return i;
}
function migrateNotes(items, note = "") {
  const legacy = items.filter((i) => i.note).map((i) => i.name + "：" + i.note);
  items.forEach((i) => {
    delete i.note;
  });
  return [note, ...legacy].filter(Boolean).join("；");
}
onMounted(() => {
  cart.value = cart.value.filter((i) => i.group !== "減項");
  cart.value.forEach(normalizeItem);
  orderNote.value = migrateNotes(cart.value, orderNote.value);
});
const levels = ["正常", "半", "少", "微", "無"];
function add(p, option) {
  if (!writable.value || (variants(p).length && !option)) return;
  addPreparedItem(p, option, cart.value);
}
function makeOrderItem(p, option) {
  return {
    ...JSON.parse(JSON.stringify(p)),
    lineId: crypto.randomUUID(),
    variant: option?.value || "",
    price: option?.price ?? p.price,
    basePrice: option?.price ?? p.price,
    loyaltyApplied: false,
    loyaltyAmount: 0,
    mealDrink:
      p.group === "主餐"
        ? {
            name: mealDrinks[0],
            variant: "冰",
            sweetness: "正常",
            ice: "正常",
            heat: "熱",
          }
        : undefined,
    qty: 1,
    sweetness: "正常",
    ice: option?.value.startsWith("冰") ? "正常" : "",
    heat: option?.value.startsWith("熱") ? "熱" : "",
  };
}
function addPreparedItem(p, option, destination) {
  const item = makeOrderItem(p, option);
  if (isDrink(item) || item.group === "主餐") {
    itemEditTarget.value = null;
    itemEditDraft.value = item;
    itemEditDestination.value = destination;
    itemEditError.value = "";
    itemEditDialog.value.showModal();
  } else destination.push(item);
}
const itemEditDialog = ref(null),
  itemEditTarget = ref(null),
  itemEditDraft = ref(null),
  itemEditError = ref(""),
  itemEditDestination = ref(null);
function openSavedItemEditor(item) {
  itemEditTarget.value = item;
  itemEditDraft.value = JSON.parse(JSON.stringify(item));
  itemEditDraft.value.basePrice ??= item.price;
  if (item.group === "主餐")
    itemEditDraft.value.mealDrink ??= {
      name: "",
      variant: "",
      sweetness: "正常",
      ice: "正常",
      heat: "熱",
    };
  itemEditError.value = "";
  itemEditDialog.value.showModal();
}
function openCartItemEditor(item) {
  if (!writable.value) return;
  itemEditTarget.value = item;
  itemEditDraft.value = JSON.parse(JSON.stringify(item));
  itemEditDraft.value.basePrice ??= item.price;
  if (item.group === "主餐")
    itemEditDraft.value.mealDrink ??= {
      name: "",
      variant: "",
      sweetness: "正常",
      ice: "正常",
      heat: "熱",
    };
  itemEditError.value = "";
  itemEditDialog.value.showModal();
}
function chooseCartVariant(value) {
  const i = itemEditDraft.value,
    option = variants(i).find((v) => v.value === value);
  if (!option) return;
  i.variant = value;
  if (!i.priceOverridden) i.basePrice = option.price;
  i.ice = value.startsWith("冰") ? "正常" : "";
  i.heat = value.startsWith("熱") ? "熱" : "";
  reprice(i);
}
function saveCartItemEditor() {
  const i = itemEditDraft.value;
  if (
    !Number.isSafeInteger(i.basePrice) ||
    i.basePrice < 1 ||
    i.basePrice > 10000000
  ) {
    itemEditError.value = "單價須為大於 0 的整數";
    return;
  }
  if (i.group === "主餐" && !mealReady(i)) {
    itemEditError.value = "請選擇附飲料與冷熱";
    return;
  }
  reprice(i);
  if (itemEditTarget.value) {
    if (
      !(
        cart.value.includes(itemEditTarget.value) ||
        editOrder.value?.items.includes(itemEditTarget.value)
      )
    )
      return;
    Object.assign(itemEditTarget.value, i);
  } else if (itemEditDestination.value) {
    itemEditDestination.value.push(i);
  } else return;
  itemEditDestination.value = null;
  itemEditDialog.value.close();
}
const noteDialog = ref(null),
  noteDraft = ref("");
function openNoteEditor() {
  noteDraft.value = orderNote.value;
  noteDialog.value.showModal();
}
function saveNote() {
  orderNote.value = noteDraft.value;
  noteDialog.value.close();
}
function sweetnessLabel(value) {
  return value === "正常" ? "正常糖" : value + "糖";
}
function iceLabel(value) {
  return value === "正常" ? "正常冰" : value + "冰";
}
function cartItemDetails(i) {
  const parts = [];
  const add = (text, tone = "") => parts.push({ text, tone });
  if (i.variant) {
    add(
      i.variant.startsWith("冰") ? "冰" : "熱",
      i.variant.startsWith("冰") ? "cold" : "hot",
    );
  }
  if (isDrink(i)) {
    add(sweetnessLabel(i.sweetness || "正常"));
    if (i.variant?.startsWith("冰")) add(iceLabel(i.ice || "正常"));
    if (i.variant?.startsWith("熱") && i.heat === "溫") add("溫");
  }
  if (i.group === "主餐") {
    if (i.mealDrink?.name) {
      add("附" + i.mealDrink.name);
      if (i.mealDrink.variant) {
        add(i.mealDrink.variant, i.mealDrink.variant === "冰" ? "cold" : "hot");
        add(sweetnessLabel(i.mealDrink.sweetness || "正常"));
        add(
          i.mealDrink.variant === "冰"
            ? iceLabel(i.mealDrink.ice || "正常")
            : i.mealDrink.heat === "溫"
              ? "溫"
              : "",
        );
      }
    } else add("請選附飲料", "needs-choice");
  }
  if (i.loyaltyApplied) add("熟客券優惠", "loyalty");
  return parts;
}
function menuPrice(p) {
  const prices = [...new Set(variants(p).map((o) => o.price))];
  return prices.length > 1 ? prices.join("／") + " 元" : money(p.price);
}
function isDrink(i) {
  return (
    [
      "義式咖啡",
      "賽風咖啡",
      "茶",
      "香濃奶茶",
      "花草茶",
      "冰沙",
      "其他飲品",
    ].includes(i.group) && i.name !== "啤酒"
  );
}

const selectedMonth = useState("pos-selected-month", () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
  }).format(new Date()),
);
const selectedDay = ref(taipeiDay(new Date()));
function shiftDay(delta) {
  const d = new Date(selectedDay.value + "T12:00:00+08:00");
  d.setUTCDate(d.getUTCDate() + delta);
  selectedDay.value = taipeiDay(d);
  selectedMonth.value = selectedDay.value.slice(0, 7);
}
function shiftMonth(delta) {
  const [year, month] = selectedMonth.value.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  selectedMonth.value = d.toISOString().slice(0, 7);
}
const dailyTotal = computed(() =>
  orders.value
    .filter((o) => dayKey(o.date) === selectedDay.value)
    .reduce((n, o) => n + o.total, 0),
);
const ordersReady = ref(false),
  ordersLoading = ref(false);
let monthLoadSequence = 0;
watch(selectedMonth, async () => {
  const sequence = ++monthLoadSequence;
  ordersLoading.value = true;
  if (selectedDay.value && !selectedDay.value.startsWith(selectedMonth.value))
    selectedDay.value = selectedMonth.value + "-01";
  try {
    await refreshLocal();
    const current = taipeiDay(new Date()).slice(0, 7);
    if (
      selectedMonth.value < current &&
      connected.value &&
      online.value &&
      orders.value.length === 0
    )
      await downloadMonth();
  } catch (error) {
    showSnackbar("讀取月份資料失敗：" + error.message);
  } finally {
    if (sequence === monthLoadSequence) ordersLoading.value = false;
  }
});
const orderFilter = ref("全部");
const sortedOrders = computed(() =>
  [...orders.value].sort((a, b) => new Date(b.date) - new Date(a.date)),
);
const filteredOrders = computed(() =>
  sortedOrders.value.filter(
    (o) => !selectedDay.value || dayKey(o.date) === selectedDay.value,
  ),
);
const days = computed(() => dailyRevenue(orders.value, selectedMonth.value));
const maxRevenue = computed(() =>
  Math.max(
    1000,
    Math.ceil(Math.max(0, ...days.value.map((d) => d.total)) / 1000) * 1000,
  ),
);
const maxOrders = computed(() =>
  Math.max(
    10,
    Math.ceil(Math.max(0, ...days.value.map((d) => d.count)) / 10) * 10,
  ),
);
const chartWidth = computed(() => Math.max(560, days.value.length * 32 + 32));
const revenueTicks = computed(() =>
  Array.from({ length: 5 }, (_, i) =>
    Math.round((maxRevenue.value * (4 - i)) / 4),
  ),
);
const orderTicks = computed(() =>
  Array.from({ length: 5 }, (_, i) =>
    Math.round((maxOrders.value * (4 - i)) / 4),
  ),
);
const chartPoints = computed(() =>
  days.value.map((day, index) => ({
    date: day.date,
    total: day.total,
    count: day.count,
    x: 32 + index * 32,
    y: 220 - (day.total / maxRevenue.value) * 180,
    barHeight: (day.count / maxOrders.value) * 180,
  })),
);
const chartPath = computed(() =>
  chartPoints.value
    .map(
      (point, index) =>
        (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1),
    )
    .join(" "),
);
const chartTooltip = ref(null);
const chartTooltipElement = ref(null);
function showChartDay(point, event) {
  const box = event.currentTarget.getBoundingClientRect();
  const x = event.clientX || box.left + box.width / 2;
  const y = event.clientY || box.top + box.height / 2;
  chartTooltip.value = {
    date: point.date,
    total: point.total,
    count: point.count,
    left: Math.max(12, Math.min(window.innerWidth - 232, x - 110)),
    top: Math.max(12, Math.min(window.innerHeight - 142, y - 150)),
  };
}
function closeChartTooltip(event) {
  if (
    chartTooltip.value &&
    !chartTooltipElement.value?.contains(event.target) &&
    !event.target?.closest?.("[data-chart-day]")
  )
    chartTooltip.value = null;
}
onMounted(() => document.addEventListener("pointerdown", closeChartTooltip));
onBeforeUnmount(() =>
  document.removeEventListener("pointerdown", closeChartTooltip),
);
watch(selectedMonth, () => {
  chartTooltip.value = null;
});
const average = computed(() =>
  orders.value.length ? Math.round(net.value / orders.value.length) : 0,
);
const dineIn = computed(
  () => orders.value.filter((o) => o.kind === "內用").length,
);
const popular = computed(() => {
  const map = new Map();
  orders.value.forEach((o) =>
    o.items.forEach((i) => {
      const p = map.get(i.id) || { name: i.name, qty: 0, total: 0 };
      p.qty += i.qty;
      p.total += i.price * i.qty;
      map.set(i.id, p);
    }),
  );
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
});
const timeLabel = (date) =>
  new Date(date).toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const dateLabel = (date) => dayKey(date);
const orderLabel = (o) =>
  o.orderNo ? "#" + o.orderNo.split("-").at(-1) : "舊單";
const pendingIds = ref(new Set());
const pendingCount = ref(0),
  lastSync = ref(""),
  monthComplete = ref(false),
  demoCount = ref(0),
  demoMonths = ref([]);
async function refreshLocal() {
  const state = await localRead();
  const demo = state.orders.filter((o) => o.demoSeed);
  demoCount.value = demo.length;
  demoMonths.value = [...new Set(demo.map((o) => o.month))].sort();
  cloudOrders.value = state.orders.filter(
    (o) => o.month === selectedMonth.value,
  );
  pendingCount.value = state.queue.length;
  pendingIds.value = new Set(state.queue.map((op) => op.order.id));
  lastSync.value = state.lastSync || "";
  monthComplete.value = state.cachedMonth === selectedMonth.value;
  inspectStorage().catch(() => {
    storageUsage.value = "暫時無法取得用量";
  });
}
const seedingDemo = ref(false);
async function seedDemoData() {
  if (seedingDemo.value) return;
  if (demoCount.value) {
    showSnackbar("請先清除現有測試資料，再重新建立");
    return;
  }
  seedingDemo.value = true;
  try {
    const count = await localChange((state) =>
      makeDemoOrders(state, menu, loyaltyDiscount.value),
    );
    const [year, month] = taipeiDay(new Date())
      .slice(0, 7)
      .split("-")
      .map(Number);
    selectedMonth.value = new Date(Date.UTC(year, month - 2, 1))
      .toISOString()
      .slice(0, 7);
    selectedDay.value = selectedMonth.value + "-01";
    await refreshLocal();
    showSnackbar(`已建立 ${count} 筆本機測試訂單`);
  } catch (error) {
    showSnackbar("建立測試資料失敗：" + error.message);
  } finally {
    seedingDemo.value = false;
  }
}
const managingDemo = ref(false);
async function uploadDemoData() {
  if (managingDemo.value || busy.value) return;
  managingDemo.value = true;
  try {
    const count = await localChange((state) => {
      state.orders = state.orders.map((order) => order.demoSeed ? normalizeDemoOrder(order) : order);
      state.queue = state.queue.map((op) => op.order.demoSeed
        ? { ...op, order: normalizeDemoOrder(op.order) } : op);
      const queued = new Set(state.queue.map((op) => op.order.id));
      const demo = state.orders.filter((order) => order.demoSeed && !order.demoUploaded && !queued.has(order.id));
      for (const order of demo) {
        state.queue.push({ operationId: crypto.randomUUID(), order: structuredClone(order), remove: false });
      }
      return demo.length;
    });
    await refreshLocal();
    if (count) showSnackbar(`已將 ${count.toLocaleString()} 筆測試訂單加入上傳佇列`);
    await sync();
  } catch (error) {
    showSnackbar("測試資料上傳失敗：" + error.message);
  } finally {
    managingDemo.value = false;
  }
}
async function clearDemoData() {
  if (managingDemo.value || busy.value) return;
  managingDemo.value = true;
  try {
    const result = await localChange((state) => {
      const demo = state.orders.filter((order) => order.demoSeed);
      const ids = new Set(demo.map((order) => order.id));
      state.queue = state.queue.filter((op) => !ids.has(op.order.id));
      for (const order of demo.filter((order) => order.demoUploaded)) {
        state.queue.push({ operationId: crypto.randomUUID(), order: structuredClone(order), remove: true });
      }
      state.orders = state.orders.filter((order) => !ids.has(order.id));
      return { local: demo.length, remote: demo.filter((order) => order.demoUploaded).length };
    });
    await refreshLocal();
    showSnackbar(result.remote
      ? `已清除 ${result.local.toLocaleString()} 筆本機測試訂單；${result.remote.toLocaleString()} 筆雲端刪除待上傳`
      : `已清除 ${result.local.toLocaleString()} 筆測試訂單`);
  } catch (error) {
    showSnackbar("清除測試資料失敗：" + error.message);
  } finally {
    managingDemo.value = false;
  }
}
function showLatestDemoMonth() {
  const month = demoMonths.value.at(-1);
  if (month) {
    selectedMonth.value = month;
    selectedDay.value = month + "-01";
    router.push("/accounts");
  }
}
onMounted(async () => {
  try {
    await refreshLocal();
  } catch (error) {
    showSnackbar("本機資料讀取失敗：" + error.message);
  } finally {
    ordersReady.value = true;
  }
});
async function loadCloud(key) {
  const month = selectedMonth.value;
  const local = await localRead();
  return fetchCloudMonth(key, month, local, requestAppsScript);
}
function applyCloud() {
  refreshLocal();
}
async function resolveLegacy(key) {
  if (!pendingCheckout.value) return;
  const pending = JSON.parse(JSON.stringify(pendingCheckout.value));
  try {
    const result = await requestAppsScript(key, {
      action: "get",
      id: pending.id,
    });
    await localChange((state) => {
      if (!state.orders.some((o) => o.id === pending.id))
        state.orders.push(result.data);
      const day = taipeiDay(result.data.date);
      state.counters[day] = Math.max(
        state.counters[day] || 0,
        Number(result.data.orderNo?.split("-").pop()) || 0,
      );
    });
  } catch (e) {
    if (e.code !== "NOT_FOUND") throw e;
    await saveLocal(pending);
  }
  pendingCheckout.value = null;
  localStorage.removeItem("mu-pendingCheckout");
  cart.value = [];
  orderNote.value = "";
  await refreshLocal();
}
async function downloadMonth() {
  if (!connected.value) {
    connectDialog.value.showModal();
    return;
  }
  if (busy.value) return;
  busy.value = true;
  try {
    const remote = await loadCloud(accessKey.value);
    await localChange((state) => {
      const dirty = new Set(state.queue.map((o) => o.order.id));
      state.orders = state.orders.filter(
        (o) => o.demoSeed || o.month !== remote.month || dirty.has(o.id),
      );
      state.orders.push(...remote.orders.filter((o) => !dirty.has(o.id)));
      state.cachedMonth = remote.month;
      state.syncCursor = remote.cursor;
      remote.orders.forEach((o) => {
        const day = taipeiDay(o.date);
        state.counters[day] = Math.max(
          state.counters[day] || 0,
          Number(o.orderNo?.split("-").pop()) || 0,
        );
      });
    });
    await refreshLocal();
    showSnackbar("月份資料已下載");
  } catch (e) {
    showSnackbar(e.message);
  } finally {
    busy.value = false;
  }
}
async function connect() {
  if (connecting.value) return;
  connecting.value = true;
  connectError.value = "";
  try {
    const key = keyInput.value.trim();
    await requestAppsScript(key, {
      action: "list",
      month: selectedMonth.value,
      offset: 0,
    });
    accessKey.value = key;
    localStorage.setItem("mu-pos-access-key", key);
    connected.value = true;
    await resolveLegacy(key);
    keyInput.value = "";
    const continueMenu = resumeMenuSave.value,
      continueMenuForce = resumeMenuForce.value,
      continueSync = resumeSync.value;
    resumeMenuSave.value = false;
    resumeMenuForce.value = false;
    resumeSync.value = false;
    connectDialog.value.close();
    showSnackbar("已連線");
    if (continueMenu) {
      const menuSaved = await saveMenuDraft(continueMenuForce);
      if (menuSaved) menuSaveConfirmDialog.value?.close();
      if (!menuDraftDirty.value && pendingLeave) {
        leaveMenuDialog.value?.close();
        pendingLeave(true);
        pendingLeave = null;
      }
    }
    if (continueSync) await sync();
  } catch (e) {
    connectError.value = e.message;
  } finally {
    connecting.value = false;
  }
}
async function sync() {
  if (busy.value) return;
  let state;
  try {
    state = await localRead();
  } catch (error) {
    recordSyncError("本機資料讀取失敗：" + error.message);
    return;
  }
  if (!state.queue.length) {
    showSnackbar("目前沒有需要備份的資料");
    return;
  }
  try {
    if (navigator.locks) {
      await navigator.locks.request(
        "mu-pos-sync",
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            recordSyncError("另一個分頁正在同步");
            return;
          }
          await performSync();
        },
      );
    } else await performSync();
  } catch (error) {
    recordSyncError("同步啟動失敗：" + error.message);
  }
}
async function sendSyncBatch(batch) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestAppsScript(accessKey.value, {
        action: "sync",
        operations: batch,
      });
    } catch (e) {
      const retryable =
        e instanceof TypeError ||
        !e.code ||
        ["RATE_LIMITED", "BUSY_RETRY", "SERVER_ERROR"].includes(e.code);
      if (!retryable || attempt >= (e.code === "RATE_LIMITED" ? 4 : 2)) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, e.code === "RATE_LIMITED" ? 16000 : 500 * 2 ** attempt + Math.random() * 250),
      );
    }
  }
}
async function performSync() {
  if (busy.value) return;
  if (!connected.value) {
    resumeSync.value = true;
    requireAccess();
    return;
  }
  busy.value = true;
  syncingBackup.value = true;
  try {
    // Existing demo operations may have been queued before the cloud variant fix.
    await localChange((state) => {
      state.queue = state.queue.map((op) => op.order.demoSeed
        ? { ...op, order: normalizeDemoOrder(op.order) } : op);
      state.orders = state.orders.map((order) => order.demoSeed
        ? normalizeDemoOrder(order) : order);
    });
    const snapshot = (await localRead()).queue;
    syncTotal.value = snapshot.length;
    syncCompleted.value = 0;
    let offset = 0;
    let maxBatch = 10;
    let emptyBatches = 0;
    while (offset < snapshot.length) {
      const batch = [];
      while (offset < snapshot.length && batch.length < maxBatch) {
        const next = snapshot[offset];
        if (
          new TextEncoder().encode(
            JSON.stringify({
              action: "sync",
              operations: [...batch, next],
              key: accessKey.value,
            }),
          ).length > 100000
        ) {
          if (!batch.length) throw Error("單筆同步資料過大，請備份並檢查訂單");
          break;
        }
        batch.push(next);
        offset++;
      }
      const r = await sendSyncBatch(batch);
      for (const result of r.data) {
        if (!result.ok)
          throw Error(
            `第 ${syncCompleted.value + 1}／${syncTotal.value} 筆（${batch.find((op) => op.operationId === result.operationId)?.order.orderNo || "未知訂單"}）：` + (result.error === "ORDER_NUMBER_CONFLICT"
              ? "流水號重複，請重新編號後再同步"
              : result.error),
          );
        await localChange((state) => {
          const operation = state.queue.find((x) => x.operationId === result.operationId);
          if (operation?.order.demoSeed && !operation.remove) {
            const order = state.orders.find((x) => x.id === operation.order.id);
            if (order) order.demoUploaded = true;
          }
          state.queue = state.queue.filter(
            (x) => x.operationId !== result.operationId,
          );
        });
        syncCompleted.value++;
      }
      if (r.data.length < batch.length) {
        offset -= batch.length - r.data.length;
        maxBatch = Math.max(1, Math.floor(maxBatch / 2));
        if (!r.data.length && ++emptyBatches >= 3)
          throw Error("雲端連續未處理同步資料，請稍後重試");
        if (!r.data.length) await new Promise((resolve) => setTimeout(resolve, 1500));
      } else emptyBatches = 0;
    }
    await localChange((state) => {
      state.lastSync = new Date().toISOString();
    });
    await pruneBackedUp();
    await refreshLocal();
    syncError.value = "";
    sessionStorage.removeItem("mu-last-sync-error");
    showSnackbar(
      pendingCount.value
        ? "部分完成，仍有 " + pendingCount.value + " 筆待同步"
        : "同步完成",
    );
  } catch (e) {
    if (e.code === "UNAUTHORIZED") {
      resumeSync.value = true;
      requireAccess("存取密碼已失效，請重新輸入");
    }
    const progress = syncTotal.value ? `（已完成 ${syncCompleted.value}／${syncTotal.value} 筆）` : "";
    recordSyncError("同步未完成" + progress + "：" + e.message);
  } finally {
    busy.value = false;
    try {
      await refreshLocal();
    } finally {
      syncingBackup.value = false;
    }
  }
}
const checkoutDialog = ref(null);
function openCheckoutConfirm() {
  if (!cart.value.length || saving.value) return;
  if (cart.value.some((i) => !mealReady(i))) {
    showSnackbar("請先選擇主餐附飲料與冷熱");
    return;
  }
  checkoutDialog.value.showModal();
}
async function checkout() {
  if (pendingCheckout.value) {
    connectDialog.value.showModal();
    return;
  }
  if (!cart.value.length || saving.value) return;
  if (cart.value.some((i) => !mealReady(i))) {
    showSnackbar("請先選擇主餐附飲料與冷熱");
    return;
  }
  saving.value = true;
  try {
    await saveLocal({
      kind: kind.value,
      table: table.value,
      note: orderNote.value,
      items: JSON.parse(JSON.stringify(cart.value)),
    });
    checkoutDialog.value?.close();
    cart.value = [];
    orderNote.value = "";
    pendingCheckout.value = null;
    await refreshLocal();
    showSnackbar("已儲存於本機");
  } catch (e) {
    showSnackbar("儲存失敗，訂單已保留：" + e.message);
  } finally {
    saving.value = false;
  }
}
const addItemDialog = ref(null);
function addToEditedOrder(p, option) {
  if (editOrder.value) addPreparedItem(p, option, editOrder.value.items);
}
const editDialog = ref(null),
  editOrder = ref(null),
  editError = ref("");
function openOrder(o) {
  editOrder.value = JSON.parse(JSON.stringify(o));
  editOrder.value.items.forEach((i) => {
    i.basePrice ??= i.price;
    if (i.group === "主餐")
      i.mealDrink ??= {
        name: "",
        variant: "",
        sweetness: "正常",
        ice: "正常",
        heat: "熱",
      };
  });
  editError.value = "";
  editDialog.value.showModal();
}
async function saveOrder() {
  try {
    if (
      editOrder.value.items.some(
        (i) =>
          !Number.isSafeInteger(i.basePrice ?? i.price) ||
          (i.basePrice ?? i.price) < 1,
      )
    )
      throw Error("單價須為大於 0 的整數");
    if (!editOrder.value.items.length)
      throw Error("訂單至少須保留一個品項；請使用整單刪除");
    if (
      editOrder.value.items.some(
        (i) => !Number.isSafeInteger(i.qty) || i.qty < 1,
      )
    )
      throw Error("數量須為大於 0 的整數");
    if (editOrder.value.items.some((i) => !mealReady(i)))
      throw Error("請先選擇主餐附飲料與冷熱");
    if (editOrder.value.demoSeed) {
      const updated = JSON.parse(JSON.stringify(editOrder.value));
      updated.total = updated.items.reduce(
        (sum, item) => sum + item.price * item.qty,
        0,
      );
      updated.updatedAt = new Date().toISOString();
      await localChange((state) => {
        const index = state.orders.findIndex(
          (order) => order.id === updated.id,
        );
        if (index < 0) throw Error("找不到測試訂單");
        state.orders[index] = updated;
        for (const op of state.queue) {
          if (op.order.id === updated.id && !op.remove) op.order = structuredClone(updated);
        }
        if (updated.demoUploaded) state.queue.push({
          operationId: crypto.randomUUID(), order: structuredClone(updated), remove: false,
        });
      });
    } else await saveLocal(JSON.parse(JSON.stringify(editOrder.value)));
    await refreshLocal();
    editDialog.value.close();
    showSnackbar("已儲存於本機");
  } catch (e) {
    editError.value = e.message;
  }
}
const deleteDialog = ref(null),
  deleteTarget = ref(null);
function deleteOrder(o) {
  deleteTarget.value = o;
  deleteDialog.value.showModal();
}
async function confirmDelete() {
  try {
    if (deleteTarget.value.demoSeed) {
      await localChange((state) => {
        const target = deleteTarget.value;
        state.queue = state.queue.filter((op) => op.order.id !== target.id);
        if (target.demoUploaded) state.queue.push({
          operationId: crypto.randomUUID(), order: structuredClone(target), remove: true,
        });
        state.orders = state.orders.filter(
          (order) => order.id !== target.id,
        );
      });
    } else
      await saveLocal(JSON.parse(JSON.stringify(deleteTarget.value)), true);
    await refreshLocal();
    deleteDialog.value.close();
    showSnackbar(
      deleteTarget.value.demoSeed ? "已刪除本機測試訂單" : "刪除待同步",
    );
  } catch (e) {
    showSnackbar(e.message);
  }
}
async function renumberPending() {
  try {
    if (!connected.value) throw Error("請先連線");
    const state = await localRead();
    const months = [
      ...new Set(
        state.queue.filter((o) => !o.remove).map((o) => o.order.month),
      ),
    ];
    const remote = (
      await Promise.all(
        months.map((month) =>
          requestAppsScript(accessKey.value, { action: "list", month }),
        ),
      )
    ).flatMap((r) => r.data);
    await localChange((state) => {
      const existing = new Map(remote.map((o) => [o.id, o]));
      remote.forEach((o) => {
        const day = taipeiDay(o.date);
        state.counters[day] = Math.max(
          state.counters[day] || 0,
          Number(o.orderNo?.split("-").pop()) || 0,
        );
      });
      const assigned = new Map();
      state.queue.forEach((op) => {
        if (op.remove) return;
        let number =
          assigned.get(op.order.id) || existing.get(op.order.id)?.orderNo;
        if (!number) {
          const day = taipeiDay(op.order.date);
          state.counters[day] = (state.counters[day] || 0) + 1;
          number =
            day.replaceAll("-", "") +
            "-" +
            String(state.counters[day]).padStart(3, "0");
        }
        assigned.set(op.order.id, number);
        op.order.orderNo = number;
        const order = state.orders.find((o) => o.id === op.order.id);
        if (order) order.orderNo = number;
      });
    });
    await refreshLocal();
    showSnackbar("待同步單已重新編號，請再點同步");
  } catch (e) {
    showSnackbar(e.message);
  }
}
async function backupLocal() {
  try {
    const state = await localRead();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify({ format: "mu-pos-backup-v1", state })], {
        type: "application/json",
      }),
    );
    a.download = "mu-pos-" + taipeiDay(new Date()) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    showSnackbar(e.message);
  }
}
async function restoreLocal(event) {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 50000000) throw Error("備份檔過大");
    const backup = JSON.parse(await file.text());
    const state = backup.state;
    if (
      backup.format !== "mu-pos-backup-v1" ||
      !Array.isArray(state?.orders) ||
      !Array.isArray(state?.queue) ||
      state.orders.some((o) => !o.id || !Array.isArray(o.items)) ||
      state.queue.some((o) => !o.operationId || !o.order?.id)
    )
      throw Error("備份格式不符");
    await localChange((current) => {
      const pendingIds = new Set(current.queue.map((o) => o.order.id));
      state.orders.forEach((o) => {
        if (!current.orders.some((x) => x.id === o.id) && !pendingIds.has(o.id))
          current.orders.push(o);
      });
      state.queue.forEach((o) => {
        if (
          !current.queue.some((x) => x.operationId === o.operationId) &&
          !pendingIds.has(o.order.id)
        )
          current.queue.push(o);
      });
      Object.entries(state.counters || {}).forEach(([day, n]) => {
        if (Number.isSafeInteger(n))
          current.counters[day] = Math.max(current.counters[day] || 0, n);
      });
    });
    await refreshLocal();
    showSnackbar("備份已合併，請確認待同步資料");
  } catch (e) {
    showSnackbar(e.message);
  } finally {
    event.target.value = "";
  }
}
function exportCsv() {
  const rows = [
    ["日期", "類型", "金額"],
    ...orders.value.map((o) => [o.date, "營收", o.total]),
  ];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob(
      [
        "\ufeff" +
          rows
            .map((r) =>
              r
                .map((value) => {
                  let text = String(value);
                  if (/^[=+@\-\t\r\n]/.test(text)) text = "'" + text;
                  return '"' + text.replaceAll('"', '""') + '"';
                })
                .join(","),
            )
            .join("\n"),
      ],
      { type: "text/csv" },
    ),
  );
  a.download = "accounts.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
</script>
<template>
  <dialog ref="leaveMenuDialog" class="settings-dialog">
    <h2>菜單尚未儲存</h2>
    <p>離開前要儲存並上傳至 Google Sheet 嗎？</p>
    <p class="field-error">{{ menuSaveError }}</p>
    <div class="settings-dialog-actions">
      <button @click="finishLeave('cancel')">繼續編輯</button
      ><button @click="finishLeave('discard')">不儲存</button
      ><button
        class="primary"
        :disabled="menuSaving"
        @click="finishLeave('save')"
      >
        儲存並離開
      </button>
    </div>
  </dialog>
  <dialog ref="loyaltyDialog" class="settings-dialog">
    <form @submit.prevent="saveLoyalty">
      <h2>調整熟客券優惠</h2>
      <label
        >每份折抵金額（元）<input
          v-model="loyaltyDraft"
          type="number"
          min="1"
          max="10000000"
          step="1"
      /></label>
      <p class="field-error">{{ loyaltyError }}</p>
      <div class="settings-dialog-actions">
        <button type="button" @click="loyaltyDialog.close()">取消</button
        ><button class="primary">儲存</button>
      </div>
    </form>
  </dialog>
  <dialog ref="deleteDialog" class="table-dialog price-dialog">
    <h2>刪除訂單</h2>
    <p>將永久刪除整列訂單，無法復原。</p>
    <p>訂單編號：{{ deleteTarget?.orderNo || "舊單（無流水編號）" }}</p>
    <div class="settings-dialog-actions">
      <button :disabled="busy" @click="deleteDialog.close()">取消</button
      ><button class="primary" :disabled="busy" @click="confirmDelete">
        確認刪除
      </button>
    </div>
  </dialog>
  <dialog
    ref="editDialog"
    class="table-dialog order-edit-dialog"
    aria-labelledby="edit-title"
  >
    <form v-if="editOrder" @submit.prevent="saveOrder">
      <header class="order-edit-head">
        <div>
          <h2 id="edit-title">編輯訂單</h2>
          <small>{{ editOrder.orderNo || editOrder.id }}</small>
        </div>
        <strong>{{
          money(editOrder.items.reduce((n, i) => n + i.price * i.qty, 0))
        }}</strong>
      </header>
      <div class="order-edit-scroll">
        <p class="order-edit-fixed">
          {{
            editOrder.kind === "外帶"
              ? "外帶"
              : "內用・" + editOrder.table + " 桌"
          }}
        </p>
        <label class="order-edit-note"
          >整單備註<textarea
            v-model="editOrder.note"
            rows="3"
            maxlength="2000"
            placeholder="輸入整單備註"
          ></textarea>
        </label>
        <div class="order-edit-items">
          <OrderItemCard
            v-for="(i, n) in editOrder.items"
            :key="i.lineId"
            :item="i"
            :index="n"
            :details="cartItemDetails(i)"
            @edit="openSavedItemEditor(i)"
            @remove="editOrder.items.splice(n, 1)"
            @quantity="
              (delta) => (i.qty = Math.max(1, Math.min(999, i.qty + delta)))
            "
          />
        </div>
        <button
          type="button"
          class="order-edit-add-button"
          @click="addItemDialog.showModal()"
        >
          ＋ 加入品項
        </button>
      </div>
      <p class="field-error" role="alert">{{ editError }}</p>
      <div class="settings-dialog-actions order-edit-actions">
        <button type="button" @click="editDialog.close()">取消</button
        ><button class="primary" :disabled="busy" type="submit">
          儲存訂單
        </button>
      </div>
    </form>
  </dialog>
  <dialog
    ref="addItemDialog"
    class="table-dialog add-item-dialog"
    aria-label="加入品項"
  >
    <div class="add-item-dialog-head">
      <h2>加入品項</h2>
      <button type="button" @click="addItemDialog.close()">完成</button>
    </div>
    <MenuCatalog
      :groups="groups"
      :items="menu"
      :get-variants="variants"
      :get-price="menuPrice"
      @select="addToEditedOrder"
    />
  </dialog>
  <dialog
    ref="connectDialog"
    class="table-dialog price-dialog"
    @close="
      resumeMenuSave = false;
      resumeSync = false;
    "
    aria-labelledby="connect-title"
  >
    <form @submit.prevent="connect">
      <h2 id="connect-title">連線帳務</h2>
      <label for="access-key">存取密碼</label
      ><input
        id="access-key"
        autofocus
        v-model="keyInput"
        type="password"
        autocomplete="off"
        required
      />
      <p class="price-error" role="alert">{{ connectError }}</p>
      <p v-if="resumeMenuSave">連線成功後將自動儲存並同步菜單。</p>
      <p>密碼會記住於這台裝置；中斷連線可移除此裝置保存的密碼。</p>
      <div class="row">
        <button type="button" :disabled="connecting" @click="cancelConnect()">
          取消</button
        ><button class="primary" :disabled="connecting">
          {{ connecting ? "連線中…" : "連線" }}
        </button>
      </div>
    </form>
  </dialog>
  <Teleport to="body"
    ><div v-if="snackbar" class="snackbar" role="status" aria-live="polite">
      {{ snackbar }}
    </div></Teleport
  >
  <dialog
    ref="uploadDialog"
    class="upload-overlay-dialog"
    aria-label="菜單上傳中"
    @cancel.prevent
  >
    <div class="upload-overlay-card" role="status" aria-live="polite">
      <span class="upload-spinner" aria-hidden="true"></span
      ><strong>菜單上傳中</strong><small>正在儲存並同步至 Google Sheet…</small>
    </div>
  </dialog>
  <dialog
    ref="backupOverlayDialog"
    class="upload-overlay-dialog"
    aria-label="訂單備份中"
    @cancel.prevent
  >
    <div class="upload-overlay-card" role="status" aria-live="polite">
      <span class="upload-spinner" aria-hidden="true"></span>
      <strong>備份中</strong>
      <small>{{
        syncTotal
          ? `已處理 ${syncCompleted}／${syncTotal} 筆待備份變更`
          : "正在檢查待備份資料與菜單…"
      }}</small>
    </div>
  </dialog>
  <dialog
    ref="itemEditDialog"
    class="table-dialog cart-item-dialog"
    aria-label="編輯品項"
  >
    <form v-if="itemEditDraft" @submit.prevent="saveCartItemEditor">
      <h2>{{ itemEditTarget ? "編輯" : "加入" }} {{ itemEditDraft.name }}</h2>
      <div v-if="variants(itemEditDraft).length" class="cart-edit-field">
        <span>冷熱</span>
        <div class="option-tabs">
          <button
            v-for="option in variants(itemEditDraft)"
            :key="option.value"
            type="button"
            :class="{ selected: itemEditDraft.variant === option.value }"
            @click="chooseCartVariant(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <div v-if="isDrink(itemEditDraft)" class="cart-edit-field">
        <span>甜度</span>
        <div class="option-tabs">
          <button
            v-for="v in levels"
            :key="v"
            type="button"
            :class="{ selected: itemEditDraft.sweetness === v }"
            @click="itemEditDraft.sweetness = v"
          >
            {{ v }}
          </button>
        </div>
      </div>
      <div
        v-if="itemEditDraft.variant?.startsWith('冰')"
        class="cart-edit-field"
      >
        <span>冰量</span>
        <div class="option-tabs">
          <button
            v-for="v in levels"
            :key="v"
            type="button"
            :class="{ selected: itemEditDraft.ice === v }"
            @click="itemEditDraft.ice = v"
          >
            {{ v }}
          </button>
        </div>
      </div>
      <div
        v-if="itemEditDraft.variant?.startsWith('熱')"
        class="cart-edit-field"
      >
        <span>溫度</span>
        <div class="option-tabs">
          <button
            v-for="v in ['熱', '溫']"
            :key="v"
            type="button"
            :class="{ selected: itemEditDraft.heat === v }"
            @click="itemEditDraft.heat = v"
          >
            {{ v }}
          </button>
        </div>
      </div>
      <template v-if="itemEditDraft.group === '主餐'"
        ><div class="cart-edit-field">
          <span>附飲料</span>
          <div class="option-tabs">
            <button
              v-for="drink in mealDrinks"
              :key="drink"
              type="button"
              :class="{ selected: itemEditDraft.mealDrink?.name === drink }"
              @click="setMealDrink(itemEditDraft, drink)"
            >
              {{ drink }}
            </button>
          </div>
        </div>
        <template v-if="itemEditDraft.mealDrink?.name"
          ><div class="cart-edit-field">
            <span>飲料冷熱</span>
            <div class="option-tabs">
              <button
                v-for="v in ['冰', '熱']"
                :key="v"
                type="button"
                :class="{ selected: itemEditDraft.mealDrink.variant === v }"
                @click="itemEditDraft.mealDrink.variant = v"
              >
                {{ v }}
              </button>
            </div>
          </div>
          <div v-if="itemEditDraft.mealDrink.variant" class="cart-edit-field">
            <span>飲料甜度</span>
            <div class="option-tabs">
              <button
                v-for="v in levels"
                :key="v"
                type="button"
                :class="{ selected: itemEditDraft.mealDrink.sweetness === v }"
                @click="itemEditDraft.mealDrink.sweetness = v"
              >
                {{ v }}
              </button>
            </div>
          </div>
          <div
            v-if="itemEditDraft.mealDrink.variant === '冰'"
            class="cart-edit-field"
          >
            <span>飲料冰量</span>
            <div class="option-tabs">
              <button
                v-for="v in levels"
                :key="v"
                type="button"
                :class="{ selected: itemEditDraft.mealDrink.ice === v }"
                @click="itemEditDraft.mealDrink.ice = v"
              >
                {{ v }}
              </button>
            </div>
          </div>
          <div
            v-if="itemEditDraft.mealDrink.variant === '熱'"
            class="cart-edit-field"
          >
            <span>飲料溫度</span>
            <div class="option-tabs">
              <button
                v-for="v in ['熱', '溫']"
                :key="v"
                type="button"
                :class="{ selected: itemEditDraft.mealDrink.heat === v }"
                @click="itemEditDraft.mealDrink.heat = v"
              >
                {{ v }}
              </button>
            </div>
          </div></template
        ></template
      >
      <label class="loyalty-switch"
        ><input
          type="checkbox"
          :checked="!!itemEditDraft.loyaltyApplied"
          @change="toggleLoyalty(itemEditDraft)"
        />套用熟客券優惠</label
      >
      <label class="cart-edit-price"
        >原單價（元）<input
          v-model.number="itemEditDraft.basePrice"
          @change="itemEditDraft.priceOverridden = true"
          type="number"
          min="1"
          max="10000000"
          step="1"
          inputmode="numeric"
      /></label>
      <p class="cart-edit-total">
        實收單價
        {{
          money(
            Math.max(
              0,
              (itemEditDraft.basePrice || 0) -
                (itemEditDraft.loyaltyApplied
                  ? itemEditDraft.loyaltyAmount
                  : 0),
            ),
          )
        }}
      </p>
      <p class="field-error" role="alert">{{ itemEditError }}</p>
      <div class="settings-dialog-actions">
        <button type="button" @click="itemEditDialog.close()">取消</button
        ><button class="primary" type="submit">
          {{ itemEditTarget ? "確認修改" : "加入品項" }}
        </button>
      </div>
    </form>
  </dialog>
  <dialog
    ref="checkoutDialog"
    class="table-dialog checkout-dialog"
    aria-labelledby="checkout-dialog-title"
  >
    <h2 id="checkout-dialog-title">確認點單</h2>
    <p>
      {{ kind === "外帶" ? "外帶" : "內用・" + table + " 桌" }} ·
      {{ cart.reduce((n, i) => n + i.qty, 0) }} 件
    </p>
    <div class="checkout-confirm-items">
      <div v-for="i in cart" :key="i.lineId">
        <span>{{ i.name }} × {{ i.qty }}</span
        ><strong>{{ money(i.qty * i.price) }}</strong>
      </div>
    </div>
    <div class="checkout-confirm-total">
      <span>總金額</span><strong>{{ money(total) }}</strong>
    </div>
    <div class="settings-dialog-actions">
      <button type="button" :disabled="saving" @click="checkoutDialog.close()">
        返回修改</button
      ><button
        type="button"
        class="primary"
        :disabled="saving"
        @click="checkout"
      >
        {{ saving ? "儲存中…" : "確認點單" }}
      </button>
    </div>
  </dialog>
  <dialog
    ref="noteDialog"
    class="table-dialog note-dialog"
    aria-label="編輯整單備註"
  >
    <form @submit.prevent="saveNote">
      <h2>整單備註</h2>
      <textarea
        v-model="noteDraft"
        rows="7"
        maxlength="2000"
        placeholder="輸入整單備註"
      ></textarea>
      <div class="settings-dialog-actions">
        <button type="button" @click="noteDialog.close()">取消</button
        ><button class="primary" type="submit">確認</button>
      </div>
    </form>
  </dialog>
  <dialog
    ref="tableDialog"
    class="table-dialog"
    aria-labelledby="table-dialog-title"
    @click="
      (event) => {
        if (event.target === tableDialog) tableDialog.close();
      }
    "
  >
    <div class="dialog-heading">
      <h2 id="table-dialog-title">選擇桌號</h2>
      <button
        class="table-close"
        type="button"
        autofocus
        aria-label="關閉桌號選擇"
        @click="tableDialog.close()"
      >
        ×
      </button>
    </div>
    <div class="table-grid">
      <button
        v-for="choice in tableChoices"
        :key="choice"
        :class="{
          selected:
            choice === '外帶'
              ? kind === '外帶'
              : kind === '內用' && table === choice,
        }"
        :aria-pressed="
          choice === '外帶'
            ? kind === '外帶'
            : kind === '內用' && table === choice
        "
        @click="chooseTable(choice)"
      >
        {{ choice }}
      </button>
    </div>
  </dialog>
  <div class="shell">
    <aside>
      <nav>
        <NuxtLink to="/"><UiIcon name="menu" />點餐</NuxtLink
        ><NuxtLink to="/orders"><UiIcon name="orders" />訂單</NuxtLink
        ><NuxtLink to="/accounts"><UiIcon name="chart" />營收</NuxtLink
        ><NuxtLink to="/settings"><UiIcon name="settings" />設定</NuxtLink
        ><NuxtLink to="/backup" class="backup-nav-link"
          ><img :src="backupIcon" class="ui-icon svg-icon" alt="" />備份</NuxtLink
        >
      </nav>
    </aside>
    <main>
      <div v-if="message" class="notice" @click="message = ''">
        {{ message }} ×
      </div>
      <div
        v-if="
          (!menuReady && (isPage('/') || isPage('/settings'))) ||
          ((!ordersReady || ordersLoading) &&
            (isPage('/orders') || isPage('/accounts')))
        "
        class="menu-loading"
        role="status"
      >
        <span class="upload-spinner" aria-hidden="true"></span
        >{{
          isPage("/orders") || isPage("/accounts")
            ? "正在讀取本機訂單…"
            : "正在讀取本機菜單…"
        }}
      </div>
      <div v-else-if="isPage('/')" class="workspace">
        <MenuCatalog
          :groups="groups"
          :items="menu"
          :get-variants="variants"
          :get-price="menuPrice"
          :disabled="!writable"
          @select="add"
        />
        <section class="ticket" :class="{ 'mobile-open': mobileOrderOpen }">
          <div class="mobile-ticket-head">
            <h2>本次訂單</h2>
            <button
              type="button"
              class="mobile-ticket-close"
              aria-label="關閉訂單"
              @click="mobileOrderOpen = false"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            class="order-note-preview"
            :disabled="!writable"
            @click="openNoteEditor"
          >
            <span class="order-note-preview-label">整單備註</span
            ><span class="order-note-preview-text">{{
              orderNote || "新增整單備註"
            }}</span
            ><span class="order-note-edit">編輯</span>
          </button>
          <button
            class="table-picker"
            :disabled="!writable"
            @click="tableDialog.showModal()"
          >
            {{ kind === "外帶" ? "外帶" : "內用・" + table + " 桌"
            }}<span>選擇桌號</span>
          </button>
          <p v-if="pendingCheckout" class="pending-note">
            此單待確認，請連線後重試結單。
          </p>
          <div class="cart" :inert="!writable">
            <p v-if="!cart.length" class="empty">尚未加入品項</p>
            <OrderItemCard
              v-for="(i, index) in cart"
              :key="i.lineId || index"
              :item="i"
              :index="index"
              :details="cartItemDetails(i)"
              :disabled="!writable"
              price-at-bottom
              @edit="openCartItemEditor(i)"
              @remove="cart.splice(index, 1)"
              @quantity="
                (delta) => (i.qty = Math.max(1, Math.min(999, i.qty + delta)))
              "
            />
          </div>
          <div class="checkout-bar">
            <div class="total" aria-label="總金額">
              <strong>{{ money(total) }}</strong>
            </div>
            <button
              class="primary"
              :disabled="
                saving || !cart.length || cart.some((i) => !mealReady(i))
              "
              @click="openCheckoutConfirm"
            >
              確認點單 →
            </button>
          </div>
        </section>
        <button
          class="mobile-order-trigger"
          type="button"
          @click="mobileOrderOpen = true"
        >
          本次訂單 · {{ cart.reduce((n, i) => n + i.qty, 0) }} 項
          <strong>{{ money(total) }}</strong>
        </button>
        <div
          v-if="mobileOrderOpen"
          class="mobile-order-backdrop"
          @click="mobileOrderOpen = false"
        ></div>
      </div>
      <section
        class="page-scroll dashboard"
        v-else-if="isPage('/orders')"
      >
        <header class="dashboard-header">
          <div class="metric-grid orders-metric-grid">
            <article class="metric-card featured"><p>當日營收</p><strong>{{ money(dailyTotal) }}</strong></article>
            <article class="metric-card"><p>本月營收</p><strong>{{ money(net) }}</strong></article>
          </div>
          <div class="dashboard-tools">
            <button @click="shiftDay(-1)" aria-label="前一天">
              <UiIcon name="left" /></button
            ><DatePicker
              v-model="selectedMonth"
              v-model:day="selectedDay"
            /><button @click="shiftDay(1)" aria-label="後一天">
              <UiIcon name="right" /></button
            >
          </div>
          <div class="dashboard-upload">
            <button class="primary" :disabled="busy || !online" @click="sync">
              <img :src="uploadIcon" class="ui-icon svg-icon" alt="" />{{ busy ? "上傳中…" : "上傳" }}
            </button>
            <span>未上傳 {{ pendingCount.toLocaleString() }} 筆</span>
          </div>
        </header>
        <button v-if="pendingCount" class="renumber-pending" :disabled="busy" @click="renumberPending">
          重編待同步號碼
        </button>
        <div v-if="false" class="dashboard-empty">
          <UiIcon name="link" />
          <h2>連線後查看訂單</h2>
          <p>輸入存取密碼，讀取每月訂單紀錄。</p>
          <button class="primary" @click="connectDialog.showModal()">
            連線帳務
          </button>
        </div>
        <template v-else
          ><p v-if="!filteredOrders.length" class="dashboard-empty">
            這一天尚無訂單
          </p>
          <div class="order-grid">
            <article v-for="o in filteredOrders" :key="o.id" class="order-card">
              <div class="order-card-top">
                <span class="order-number">{{ orderLabel(o) }}</span
                ><span class="sync-tag">{{
                  pendingIds.has(o.id) ? "待同步" : "已同步"
                }}</span
                ><span v-if="!o.items.length" class="refund-tag">已全退</span>
                <div class="order-card-actions">
                  <button
                    type="button"
                    class="danger-button"
                    :disabled="busy"
                    :aria-label="'刪除訂單' + orderLabel(o)"
                    title="刪除訂單"
                    @click="deleteOrder(o)"
                  >
                    <UiIcon name="trash" />
                  </button>
                </div>
              </div>
              <div class="order-card-main">
                <h2>{{ o.kind === "外帶" ? "外帶" : o.table + " 桌" }}</h2>
                <strong>{{ money(o.total) }}</strong>
              </div>
              <div class="order-card-meta">
                <span><UiIcon name="bag" />{{ itemCount(o) }} 件餐點</span
                ><span
                  ><UiIcon name="clock" />{{ dateLabel(o.date) }} ·
                  {{ timeLabel(o.date) }}</span
                >
              </div>
              <button
                class="expand-order"
                type="button"
                :disabled="busy"
                @click="openOrder(o)"
              >
                查看＆編輯明細<UiIcon name="right" />
              </button>
            </article></div
        ></template>
      </section>
      <section
        class="page-scroll dashboard"
        v-else-if="isPage('/accounts')"
      >
        <header class="dashboard-header">
          <div class="metric-grid">
            <article class="metric-card featured">
              <p>本月營收</p>
              <strong>{{ money(net) }}</strong>
            </article>
            <article class="metric-card">
              <p>本月訂單數量</p>
              <strong>{{ orders.length.toLocaleString() }} 筆</strong>
            </article>
          </div>
          <div class="dashboard-tools">
            <button @click="shiftMonth(-1)" aria-label="上個月">
              <UiIcon name="left" /></button
            ><MonthPicker v-model="selectedMonth" /><button
              @click="shiftMonth(1)"
              aria-label="下個月"
            >
              <UiIcon name="right" />
            </button>
          </div>
          <div class="dashboard-upload">
            <button class="primary" :disabled="busy || !online" @click="sync">
              <img :src="uploadIcon" class="ui-icon svg-icon" alt="" />{{ busy ? "上傳中…" : "上傳" }}
            </button>
            <span>未上傳 {{ pendingCount.toLocaleString() }} 筆</span>
          </div>
        </header>
        <article class="dashboard-panel">
          <div class="combined-chart-heading">
            <h2>每日營收與訂單量</h2>
            <div class="chart-legend">
              <span class="revenue-legend">營收折線</span
              ><span class="orders-legend">訂單長條</span>
            </div>
          </div>
          <div
            class="combined-chart"
            :aria-label="selectedMonth + ' 每日營收與訂單量圖表'"
          >
            <div class="chart-axis chart-axis-revenue">
              <strong>營收<br />元</strong>
              <div v-for="tick in revenueTicks" :key="tick">
                {{ tick.toLocaleString() }}
              </div>
            </div>
            <div class="chart-scroll">
              <svg
                :viewBox="`0 0 ${chartWidth} 260`"
                :style="{ width: chartWidth + 'px' }"
                role="img"
                :aria-label="selectedMonth + ' 每日營收折線及訂單長條圖'"
              >
                <line
                  v-for="level in 5"
                  :key="level"
                  x1="0"
                  :x2="chartWidth"
                  :y1="40 + (level - 1) * 45"
                  :y2="40 + (level - 1) * 45"
                  stroke="#eadfd3"
                  stroke-dasharray="3 4"
                />
                <rect
                  v-for="point in chartPoints"
                  :key="point.date + '-bar'"
                  :x="point.x - 10"
                  :y="220 - point.barHeight"
                  width="20"
                  :height="point.barHeight"
                  rx="3"
                  fill="#d8b899"
                >
                  <title>{{ point.date }}：{{ point.count }} 筆訂單</title>
                </rect>
                <path
                  :d="chartPath"
                  fill="none"
                  stroke="#65452f"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <g v-for="(point, index) in chartPoints" :key="point.date">
                  <circle :cx="point.x" :cy="point.y" r="4" fill="#65452f">
                    <title>
                      {{ point.date }}：營收 {{ money(point.total) }}、{{
                        point.count
                      }}
                      筆訂單
                    </title>
                  </circle>
                  <text
                    :x="point.x"
                    y="248"
                    text-anchor="middle"
                    font-size="11"
                    fill="#705748"
                  >
                    {{ point.date.slice(8) }}
                  </text>
                </g>
                <rect
                  v-for="point in chartPoints"
                  :key="point.date + '-hit'"
                  :x="point.x - 16"
                  y="40"
                  width="32"
                  height="215"
                  fill="transparent"
                  data-chart-day
                  role="button"
                  tabindex="0"
                  :aria-label="
                    point.date +
                    '，營收 ' +
                    money(point.total) +
                    '，訂單 ' +
                    point.count +
                    ' 筆'
                  "
                  @click="showChartDay(point, $event)"
                  @keydown.enter.prevent="showChartDay(point, $event)"
                  @keydown.space.prevent="showChartDay(point, $event)"
                />
              </svg>
            </div>
            <div class="chart-axis chart-axis-orders">
              <strong>訂單<br />筆</strong>
              <div v-for="tick in orderTicks" :key="tick">{{ tick }}</div>
            </div>
          </div>
          <div
            v-if="chartTooltip"
            ref="chartTooltipElement"
            class="chart-tooltip"
            :style="{
              left: chartTooltip.left + 'px',
              top: chartTooltip.top + 'px',
            }"
            role="status"
          >
            <strong>{{ chartTooltip.date }}</strong>
            <div>
              <span>營收</span><b>{{ money(chartTooltip.total) }}</b>
            </div>
            <div>
              <span>訂單量</span><b>{{ chartTooltip.count }} 筆</b>
            </div>
          </div>
        </article>
      </section>
      <section
        v-else-if="isPage('/settings')"
        class="page-scroll settings-page"
      >
        <div class="settings-wrap">
          <div class="settings-save-bar">
            <button
              type="button"
              class="settings-loyalty-action"
              @click="openLoyaltyDialog"
            >
              調整熟客券優惠 · {{ money(loyaltyDiscount) }}
            </button>
            <div class="settings-toolbar-actions">
              <button
                type="button"
                :disabled="!connected"
                @click="menuRestoreDialog.showModal()"
              >
                下載菜單</button
              ><button
                type="button"
                :disabled="menuSaving"
                @click="
                  menuDraftDirty
                    ? menuSaveConfirmDialog.showModal()
                    : saveMenuDraft(true)
                "
              >
                上傳菜單</button
              ><button
                class="primary"
                :disabled="!menuDraftDirty || menuSaving"
                @click="menuSaveConfirmDialog.showModal()"
              >
                {{ menuSaving ? "上傳中…" : "儲存菜單" }}
              </button>
            </div>
          </div>
          <div class="settings-grid">
            <section class="settings-categories">
              <div class="settings-pane-head">
                <div><h2>菜單分類</h2></div>
                <button
                  class="icon-action"
                  aria-label="新增分類"
                  @click="openCategoryDialog()"
                >
                  ＋
                </button>
              </div>
              <div class="settings-category-list">
                <div
                  v-for="(group, index) in groups"
                  :key="group[0]"
                  class="settings-category-row"
                  :class="{
                    selected: selectedSettingsCategory === group[0],
                    'sort-source':
                      dragging?.type === 'category' && dragging.id === group[2],
                    'sort-target': dropTarget === group[2],
                  }"
                  data-sort-type="category"
                  :data-sort-id="group[2]"
                >
                  <button
                    class="sort-handle"
                    type="button"
                    :aria-label="'拖曳排序' + group[0]"
                    @pointerdown="
                      (event) => startSort(event, 'category', group[2])
                    "
                    @pointermove="hoverSort"
                    @pointerup="finishSort"
                    @pointercancel="cancelSort"
                  >
                    ⠿</button
                  ><button
                    class="category-select"
                    @click="selectedSettingsCategory = group[0]"
                  >
                    <span>{{ group[0] }}</span
                    ><small
                      >{{
                        menu.filter((item) => item.group === group[0]).length
                      }}
                      項</small
                    ></button
                  ><button
                    class="category-edit"
                    :aria-label="'編輯' + group[0]"
                    @click="openCategoryDialog(group)"
                  >
                    編輯
                  </button>
                </div>
              </div>
            </section>
            <div class="settings-items">
              <div class="settings-pane-head">
                <div>
                  <h2>{{ selectedSettingsCategory || "請先選擇分類" }}</h2>
                </div>
                <button
                  class="primary"
                  :disabled="!selectedSettingsCategory"
                  @click="openItemDialog()"
                >
                  ＋ 新增品項
                </button>
              </div>
              <div v-if="!visibleSettingsItems.length" class="settings-empty">
                <strong>這個分類還沒有品項</strong>
                <p>按「新增品項」開始建立菜單。</p>
              </div>
              <div class="settings-item-list">
                <article
                  v-for="(item, index) in visibleSettingsItems"
                  :key="item.id"
                  class="settings-item-card"
                  :class="{
                    'sort-source':
                      dragging?.type === 'item' && dragging.id === item.id,
                    'sort-target': dropTarget === item.id,
                  }"
                  data-sort-type="item"
                  :data-sort-id="item.id"
                >
                  <div class="settings-item-main">
                    <button
                      class="sort-handle"
                      type="button"
                      :aria-label="'拖曳排序' + item.name"
                      @pointerdown="
                        (event) => startSort(event, 'item', item.id)
                      "
                      @pointermove="hoverSort"
                      @pointerup="finishSort"
                      @pointercancel="cancelSort"
                    >
                      ⠿</button
                    ><span class="settings-item-index">{{
                      String(index + 1).padStart(2, "0")
                    }}</span>
                    <div>
                      <h3>{{ item.name }}</h3>
                      <p>{{ itemMode({ options: menuOptions(item) }) }}</p>
                    </div>
                  </div>
                  <strong>{{ menuPrice(item) }}</strong>
                  <div class="settings-item-actions">
                    <button type="button" class="settings-item-remove" @click="openRemoveItem(item)">移除</button>
                    <button @click="openItemDialog(item)">編輯</button>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
        <dialog
          ref="categoryDialog"
          class="settings-dialog"
          @click="
            (event) => {
              if (event.target === categoryDialog) categoryDialog.close();
            }
          "
        >
          <form @submit.prevent="saveCategory">
            <h2>{{ editingCategory ? "編輯分類" : "新增分類" }}</h2>
            <label
              >分類名稱<input
                v-model="categoryDraft"
                maxlength="100"
                placeholder="例如：手沖咖啡"
                autofocus
            /></label>
            <p class="field-error" role="alert">{{ categoryError }}</p>
            <div class="settings-dialog-actions">
              <button
                v-if="editingCategory"
                type="button"
                class="text-danger"
                @click="removeCategory(editingCategory)"
              >
                移除分類</button
              ><button type="button" @click="categoryDialog.close()">
                取消</button
              ><button class="primary">儲存分類</button>
            </div>
          </form>
        </dialog>
        <dialog
          ref="itemDialog"
          class="settings-dialog item-editor-dialog"
          @click="
            (event) => {
              if (event.target === itemDialog) itemDialog.close();
            }
          "
        >
          <form v-if="itemDraft" @submit.prevent="saveItemDraft">
            <h2>{{ editingItemId ? "編輯品項" : "新增品項" }}</h2>
            <div class="settings-form-grid">
              <label class="settings-item-name"
                >品項名稱<input
                  v-model="itemDraft.name"
                  type="text"
                  maxlength="200"
                  placeholder="例如：拿鐵"
                  autofocus
              /></label>
              <div ref="itemCategoryPicker" class="settings-category-field">
                <span id="item-category-label">分類</span
                ><button
                  type="button"
                  class="settings-category-trigger"
                  aria-labelledby="item-category-label"
                  :aria-expanded="itemCategoryOpen"
                  aria-controls="item-category-options"
                  @click="itemCategoryOpen = !itemCategoryOpen"
                >
                  <span>{{ itemDraft.group || "請選擇分類" }}</span
                  ><span
                    class="settings-category-chevron"
                    :class="{ open: itemCategoryOpen }"
                    aria-hidden="true"
                    >⌄</span
                  >
                </button>
                <div
                  v-if="itemCategoryOpen"
                  id="item-category-options"
                  class="settings-category-menu"
                >
                  <button
                    v-for="group in groups"
                    :key="group[2] || group[0]"
                    type="button"
                    :class="{ selected: itemDraft.group === group[0] }"
                    @click="chooseItemCategory(group[0])"
                  >
                    <span>{{ group[0] }}</span
                    ><span
                      v-if="itemDraft.group === group[0]"
                      aria-hidden="true"
                      >✓</span
                    >
                  </button>
                </div>
              </div>
            </div>
            <label>冷熱選項</label>
            <div class="settings-segments" role="group" aria-label="冷熱選項">
              <button
                v-for="mode in ['無冷熱', '僅冰', '僅熱', '冰熱都有']"
                :key="mode"
                type="button"
                :class="{ selected: itemMode(itemDraft) === mode }"
                @click="setItemMode(mode)"
              >
                {{ mode }}
              </button>
            </div>
            <div v-if="!itemDraft.options.length" class="settings-price-field">
              <label
                >單價（元）<input
                  v-model.number="itemDraft.price"
                  type="number"
                  min="1"
                  max="10000000"
                  step="1"
                  inputmode="numeric"
              /></label>
            </div>
            <div v-else class="settings-price-grid">
              <label v-for="option in itemDraft.options" :key="option.value"
                >{{ option.value.startsWith("冰") ? "冰" : "熱" }}價（元）<input
                  v-model.number="option.price"
                  type="number"
                  min="1"
                  step="1"
                  inputmode="numeric"
              /></label>
            </div>
            <p class="field-error" role="alert">{{ itemError }}</p>
            <div class="settings-dialog-actions">
              <button type="button" @click="itemDialog.close()">取消</button
              ><button class="primary">儲存品項</button>
            </div>
          </form>
        </dialog>
        <dialog ref="itemDeleteDialog" class="settings-dialog" aria-label="確認移除品項">
          <h2>移除品項</h2>
          <p>確定要移除「{{ itemDeleteTarget?.name }}」嗎？儲存菜單後會同步到雲端。</p>
          <div class="settings-dialog-actions">
            <button type="button" @click="itemDeleteDialog.close()">取消</button>
            <button type="button" class="primary" @click="confirmRemoveItem">確認移除</button>
          </div>
        </dialog>
        <dialog
          ref="menuSaveConfirmDialog"
          class="settings-dialog"
          aria-label="確認儲存菜單"
        >
          <h2>確認儲存菜單</h2>
          <p>儲存後會立即生效，並一併上傳至 Google Sheet 雲端菜單。</p>
          <div class="settings-dialog-actions">
            <button
              type="button"
              :disabled="menuSaving"
              @click="menuSaveConfirmDialog.close()"
            >
              取消</button
            ><button
              type="button"
              class="primary"
              :disabled="menuSaving"
              @click="confirmMenuSave"
            >
              {{ menuSaving ? "上傳中…" : "確認儲存並上傳" }}
            </button>
          </div>
        </dialog>
        <dialog
          ref="menuRestoreDialog"
          class="settings-dialog"
          @cancel="(event) => { if (menuDownloading) event.preventDefault(); }"
          @click="
            (event) => {
              if (event.target === menuRestoreDialog && !menuDownloading) menuRestoreDialog.close();
            }
          "
        >
          <h2>下載菜單</h2>
          <p>這會覆蓋此裝置目前的菜單設定。</p>
          <p v-if="menuDownloading" class="menu-download-status" role="status">
            <span class="upload-spinner" aria-hidden="true"></span>正在下載並儲存菜單…
          </p>
          <div class="settings-dialog-actions">
            <button :disabled="menuDownloading" @click="menuRestoreDialog.close()">取消</button
            ><button class="primary" :disabled="menuDownloading" @click="restoreMenuFromCloud">
              {{ menuDownloading ? "下載中…" : "確認下載" }}
            </button>
          </div>
        </dialog>
      </section>
      <section
        v-else-if="isPage('/backup')"
        class="page-scroll mobile-backup-page"
      >
        <div class="mobile-backup-panel">
          <h1>備份</h1>
          <div class="mobile-backup-status" role="status">
            <div>
              <span>連線狀態</span
              ><strong>{{ online ? "連線中" : "離線" }}</strong>
            </div>
            <div>
              <span>待備份訂單</span><strong>{{ pendingCount }} 筆</strong>
            </div>
            <div class="backup-time-row">
              <span>上次備份時間</span
              ><strong>{{ backupTime(lastSync) }}</strong>
            </div>
            <div>
              <span>本機儲存</span><strong>{{ storageUsage }}</strong>
            </div>
          </div>
          <div v-if="syncError" class="backup-sync-error" role="alert">
            <strong>上次同步失敗</strong>
            <p>{{ syncError }}</p>
          </div>
          <button
            class="primary mobile-backup-button"
            :disabled="busy || !online"
            @click="sync"
          >
            <img :src="backupIcon" class="ui-icon svg-icon" alt="" />{{ busy ? "備份中…" : "立即備份" }}
          </button>
          <button
            v-if="isDev"
            class="demo-seed-button"
            :disabled="seedingDemo || managingDemo || busy || demoCount > 0"
            @click="seedDemoData"
          >
            {{ seedingDemo ? "建立中…" : "建立三個月測試訂單" }}
          </button>
          <p v-if="isDev" class="demo-seed-note">
            約每日平日 50 筆、假日 100
            筆。可上傳至測試用雲端；重新建立前請先清除舊資料。
          </p>
          <div v-if="isDev && demoCount" class="demo-seed-actions">
            <button type="button" :disabled="managingDemo || busy || !online" @click="uploadDemoData">
              上傳測試資料
            </button>
            <button type="button" :disabled="managingDemo || busy" @click="clearDemoData">
              清除測試資料
            </button>
          </div>
          <div v-if="isDev && demoCount" class="demo-seed-result">
            目前有 {{ demoCount.toLocaleString() }} 筆測試訂單（{{
              demoMonths[0]
            }}
            至 {{ demoMonths.at(-1) }}）。<button
              type="button"
              @click="showLatestDemoMonth"
            >
              查看測試營收
            </button>
          </div>
        </div>
      </section>
      <section v-else class="page-scroll">
        <p>找不到此頁面</p>
        <NuxtLink to="/">返回點餐</NuxtLink>
      </section>
    </main>
  </div>
</template>
