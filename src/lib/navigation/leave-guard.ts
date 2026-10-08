// 导航租约属于当前编辑事务，离开确认不能清除尚未核对的原操作。
export type LeaveGuard = (action: () => void) => void
