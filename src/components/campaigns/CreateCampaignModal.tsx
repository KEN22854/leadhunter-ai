"use client";
import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { Button, Field, InlineError, Modal } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client-api";

export function CreateCampaignModal({
  clientIds,
  defaultName,
  open,
  onClose,
  onCreated,
}: {
  clientIds: string[];
  defaultName: string;
  open: boolean;
  onClose: () => void;
  onCreated: (campaignId: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ campaign: { id: string } }>("POST", "/api/campaigns", { name, clientIds });
      onCreated(r.campaign.id);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новая кампания">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Лидов: {clientIds.length}. Для каждого будет письмо с референсом. Вы просмотрите письма, сгенерируете недостающие референсы и одобрите кампанию — после этого письма уходят автоматически с паузами и дневным лимитом.
        </p>
        <Field label="Название">{(id) => <input id={id} className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}</Field>
        <InlineError text={err} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Позже</Button>
          <Button variant="primary" icon={<Megaphone className="h-4 w-4" />} loading={busy} disabledReason={name.trim() && clientIds.length ? undefined : "Нужно название"} onClick={create}>
            Создать кампанию
          </Button>
        </div>
      </div>
    </Modal>
  );
}
