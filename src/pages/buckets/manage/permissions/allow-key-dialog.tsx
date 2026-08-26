import Button from "@/components/ui/button";
import { useKeys } from "@/pages/keys/hooks";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Checkbox, Modal, Table } from "react-daisyui";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { AllowKeysSchema, allowKeysSchema } from "../schema";
import { useDisclosure } from "@/hooks/useDisclosure";
import { CheckboxField } from "@/components/ui/checkbox";
import { useAllowKey } from "../hooks";
import { toast } from "sonner";
import { handleError } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useBucketContext } from "../context";
import { useAuth } from "@/hooks/useAuth";

type Props = {
  currentKeys?: string[];
};

const AllowKeyDialog = ({ currentKeys }: Props) => {
  const { canWrite } = useAuth();
  const { bucket } = useBucketContext();
  const { dialogRef, isOpen, onOpen, onClose } = useDisclosure();
  const { data: keys } = useKeys();
  const form = useForm<AllowKeysSchema>({
    resolver: zodResolver(allowKeysSchema),
  });
  const { fields: keyFields } = useFieldArray({
    control: form.control,
    name: "keys",
  });
  const queryClient = useQueryClient();

  const allowKey = useAllowKey(bucket.id, {
    onSuccess: () => {
      form.reset();
      onClose();
      toast.success("Key allowed!");
      queryClient.invalidateQueries({ queryKey: ["bucket", bucket.id] });
    },
    onError: handleError,
  });

  const candidateKeys = useMemo(
    () => keys?.filter((key) => !currentKeys?.includes(key.id)) ?? [],
    [keys, currentKeys]
  );
  const candidateIds = candidateKeys.map((k) => k.id).join(",");

  useEffect(() => {
    form.setValue(
      "keys",
      candidateKeys.map((key) => ({
        checked: false,
        keyId: key.id,
        name: key.name,
        read: false,
        write: false,
        owner: false,
      }))
    );
    // Reseed only when the set of candidate keys changes, not on every
    // parent render — otherwise an in-flight selection is silently wiped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateIds]);

  const onToggleAll = (
    e: React.ChangeEvent<HTMLInputElement>,
    field: keyof AllowKeysSchema["keys"][number]
  ) => {
    const curValues = form.getValues("keys");
    const newValues = curValues.map((item) => ({
      ...item,
      [field]: e.target.checked,
    }));
    form.setValue("keys", newValues);
  };

  // `form.watch()` only takes a read-only snapshot at render time and does
  // not itself trigger a re-render of this component when a nested field
  // changes via a Controller elsewhere (see react-hook-form's `useWatch`
  // vs `watch` distinction); `useWatch` is required to react to ticks.
  const watchedKeys = useWatch({ control: form.control, name: "keys" });
  useEffect(() => {
    watchedKeys?.forEach((row, i) => {
      if (!row.checked && (row.read || row.write || row.owner)) {
        form.setValue(`keys.${i}.checked`, true);
      }
    });
  }, [watchedKeys, form]);

  const onSubmit = form.handleSubmit((values) => {
    const data = values.keys
      .filter((key) => key.checked)
      .map((key) => ({
        keyId: key.keyId,
        permissions: { read: key.read, write: key.write, owner: key.owner },
      }));

    if (data.length === 0) {
      toast.error("Select at least one key to allow.");
      return;
    }

    if (
      data.some(
        (k) => !k.permissions.read && !k.permissions.write && !k.permissions.owner
      )
    ) {
      toast.error("Each selected key needs at least one permission.");
      return;
    }

    allowKey.mutate(data);
  });

  if (!canWrite) {
    return null;
  }

  return (
    <>
      <Button icon={Plus} color="primary" onClick={onOpen}>
        Allow Key
      </Button>

      <Modal ref={dialogRef} backdrop open={isOpen} className="max-w-2xl">
        <Modal.Header className="mb-1">Allow Key</Modal.Header>
        <Modal.Body>
          <p>Enter the key you want to allow access to.</p>

          <div className="overflow-x-auto mt-4">
            <Table>
              <Table.Head>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    color="primary"
                    size="sm"
                    onChange={(e) => onToggleAll(e, "checked")}
                  />
                  Key
                </label>
                <label>Local Aliases</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    color="primary"
                    size="sm"
                    onChange={(e) => onToggleAll(e, "read")}
                  />
                  Read
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    color="primary"
                    size="sm"
                    onChange={(e) => onToggleAll(e, "write")}
                  />
                  Write
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    color="primary"
                    size="sm"
                    onChange={(e) => onToggleAll(e, "owner")}
                  />
                  Owner
                </label>
              </Table.Head>

              <Table.Body>
                {!keyFields.length ? (
                  <tr>
                    <td colSpan={5} className="text-center">
                      No keys found
                    </td>
                  </tr>
                ) : null}
                {keyFields.map((field, index) => {
                  const curKey = bucket.keys.find(
                    (key) => key.accessKeyId === field.keyId
                  );
                  return (
                    <Table.Row key={field.id}>
                      <CheckboxField
                        form={form}
                        name={`keys.${index}.checked`}
                        label={field.name || field.keyId?.substring(0, 8)}
                      />
                      <span>
                        {curKey?.bucketLocalAliases?.join(", ") || "-"}
                      </span>
                      <CheckboxField form={form} name={`keys.${index}.read`} />
                      <CheckboxField form={form} name={`keys.${index}.write`} />
                      <CheckboxField form={form} name={`keys.${index}.owner`} />
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        </Modal.Body>

        <Modal.Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            color="primary"
            disabled={allowKey.isPending}
            onClick={onSubmit}
          >
            Submit
          </Button>
        </Modal.Actions>
      </Modal>
    </>
  );
};

export default AllowKeyDialog;
