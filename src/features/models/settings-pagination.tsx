import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
export function SettingsPagination({
  total,
  page,
  size,
  onPage,
  onSize,
  label,
}: {
  total: number
  page: number
  size: number
  onPage: (page: number) => void
  onSize: (size: number) => void
  label: string
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  const numbers = [
    ...new Set(
      [1, page - 1, page, page + 1, pages].filter(
        (value) => value > 0 && value <= pages
      )
    ),
  ].sort((a, b) => a - b)
  return (
    <nav className="model-paging" aria-label={`${label}分页`}>
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)}`
          : "0"}{" "}
        / {total}
      </span>
      <span>每页</span>
      <Select
        value={String(size)}
        onValueChange={(value) => {
          onSize(Number(value))
          onPage(1)
        }}
      >
        <SelectTrigger aria-label={`${label}每页数量`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {[5, 10, 20, 50].map((value) => (
              <SelectItem value={String(value)} key={value}>
                {value}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      {numbers.map((value, index) => (
        <span key={value}>
          {index > 0 && value > numbers[index - 1] + 1 ? "…" : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`${label}第 ${value} 页`}
            aria-current={page === value ? "page" : undefined}
            onClick={() => onPage(value)}
          >
            {value}
          </Button>
        </span>
      ))}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </nav>
  )
}
