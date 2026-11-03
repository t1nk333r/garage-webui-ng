import Button from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { Modal } from "react-daisyui";
import { useForm, useWatch } from "react-hook-form";
import { useDisclosure } from "@/hooks/useDisclosure";
import { createKeySchema, CreateKeySchema } from "../schema";
import { InputField } from "@/components/ui/input";
import { CheckboxField } from "@/components/ui/checkbox";
import { useCreateKey } from "../hooks";
import { useQueryClient } from "@tanstack/react-query";
import { handleError } from "@/lib/utils";
import { toast } from "sonner";
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

const CreateKeyDialog = () => {
  const { canWrite } = useAuth();
  const { dialogRef, isOpen, onOpen, onClose } = useDisclosure();
  const form = useForm<CreateKeySchema>({
    resolver: zodResolver(createKeySchema),
    defaultValues: { name: "" },
  });
  const isImport = useWatch({ control: form.control, name: "isImport" });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isOpen) form.setFocus("name");
  }, [isOpen]);

  const createKey = useCreateKey({
    onSuccess: () => {
      onClose();
      queryClient.invalidateQueries({ queryKey: ["keys"] });
      toast.success("Key created");
    },
    onError: handleError,
  });

  const onSubmit = form.handleSubmit((values) => {
    createKey.mutate(values);
  });

  if (!canWrite) {
    return null;
  }

  return (
    <>
      <Button icon={Plus} color="primary" onClick={onOpen}>
        Create key
      </Button>

      <Modal ref={dialogRef} backdrop open={isOpen}>
        <Modal.Header className="mb-1">Create new key</Modal.Header>
        <Modal.Body>
          <p>
            Name the key. To add a key you already have, select Import
            existing.
          </p>

          <form onSubmit={onSubmit}>
            <InputField form={form} name="name" title="Key name" />
            <CheckboxField
              form={form}
              name="isImport"
              label="Import existing"
              className="mt-2"
            />

            {isImport && (
              <>
                <InputField
                  form={form}
                  name="accessKeyId"
                  title="Access key ID"
                />
                <InputField
                  form={form}
                  name="secretAccessKey"
                  title="Secret access key"
                />
              </>
            )}
          </form>
        </Modal.Body>

        <Modal.Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            color="primary"
            disabled={createKey.isPending}
            onClick={onSubmit}
          >
            Submit
          </Button>
        </Modal.Actions>
      </Modal>
    </>
  );
};

export default CreateKeyDialog;
