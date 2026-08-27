-- Add status and updated_at columns to invoices table
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'قيد المعالجة',
ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT NOW();

-- Create trigger to automatically update updated_at column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_invoices_touch ON public.invoices;
CREATE TRIGGER trg_invoices_touch
BEFORE UPDATE ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add inv_update policy (if not exists)
DO $$
BEGIN
   IF NOT EXISTS (
      SELECT 1 FROM pg_policies 
      WHERE tablename = 'invoices' AND policyname = 'inv_update'
   ) THEN
      CREATE POLICY "inv_update" ON public.invoices
         FOR UPDATE
         USING (auth.uid() IS NOT NULL)
         WITH CHECK (auth.uid() IS NOT NULL);
   END IF;
END $$;