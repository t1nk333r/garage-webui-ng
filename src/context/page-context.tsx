import React, {
  createContext,
  memo,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { LucideIcon } from "lucide-react";

type PageContextValues = {
  title: string | null;
  prev: string | null;
  actions: React.ReactNode | null;
  // Only the modern layout's page header renders these two; the classic
  // header ignores them.
  subtitle: React.ReactNode | null;
  icon: LucideIcon | null;
};

export const PageContext = createContext<
  | (PageContextValues & {
      setValue: (values: Partial<PageContextValues>) => void;
    })
  | null
>(null);

const initialValues: PageContextValues = {
  title: null,
  prev: null,
  actions: null,
  subtitle: null,
  icon: null,
};

export const PageContextProvider = ({ children }: PropsWithChildren) => {
  const [values, setValues] = useState<PageContextValues>(initialValues);

  const setValue = useCallback((value: Partial<PageContextValues>) => {
    setValues((prev) => ({ ...prev, ...value }));
  }, []);

  return (
    <PageContext.Provider children={children} value={{ ...values, setValue }} />
  );
};

type PageProps = Partial<PageContextValues>;

const Page = memo((props: PageProps) => {
  const context = useContext(PageContext);
  if (!context) {
    throw new Error("Page component must be used within a PageContextProvider");
  }

  useEffect(() => {
    context.setValue(props);

    return () => {
      context.setValue(initialValues);
    };
  }, [props, context.setValue]);

  return null;
});

export default Page;
