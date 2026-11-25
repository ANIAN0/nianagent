export async function activate({ setTranslationEnabled }) {
  try {
    await setTranslationEnabled(true)
  } catch (error) {
    try {
      await setTranslationEnabled(false)
    } catch {
      // Preserve the original activation error.
    }
    throw error
  }
  return {
    status: () => "Alt+1 划词翻译已就绪",
    close: () => setTranslationEnabled(false),
  }
}
