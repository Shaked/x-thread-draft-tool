Agent credentials: the file is replaced atomically (temp file and rename), so a concurrent reader never sees a truncated record.
