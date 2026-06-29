import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type GroupFieldProps = {
  id: string
  value: string
  onChange: (value: string) => void
  label?: string
}

export function GroupField({ id, value, onChange, label = "Group" }: GroupFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="demo"
      />
    </div>
  )
}
