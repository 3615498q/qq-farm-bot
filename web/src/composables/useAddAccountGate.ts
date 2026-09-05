import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useUserStore } from '@/stores/user'

export function useAddAccountGate() {
  const userStore = useUserStore()
  const accountStore = useAccountStore()
  const { accounts } = storeToRefs(accountStore)

  const isAccountOpsDisabled = computed(() => !userStore.isAdmin && userStore.isExpired)
  const quotaLimit = computed(() => {
    const limit = userStore.accountLimit
    if (limit === undefined || limit === null)
      return 3
    return limit
  })
  const isOverQuota = computed(() => {
    if (userStore.isAdmin)
      return false
    const limit = quotaLimit.value
    if (limit === -1)
      return false
    return accounts.value.length >= limit
  })
  const isAddAccountDisabled = computed(() => isAccountOpsDisabled.value || isOverQuota.value)
  const addAccountDisabledReason = computed(() => {
    if (isAccountOpsDisabled.value)
      return '账号已到期，无法添加账号'
    if (isOverQuota.value)
      return '已超过配额，无法添加账号'
    return ''
  })

  return {
    isAddAccountDisabled,
    addAccountDisabledReason,
    isAccountOpsDisabled,
    isOverQuota,
  }
}
