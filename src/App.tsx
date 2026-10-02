import { homeData, submitMockWork } from "@/features/home/mock-data"
import { HomePage } from "@/features/home/home-page"
export default function App() {
  return <HomePage data={homeData} onSubmit={submitMockWork} />
}
