# Noxtr

`noxtr` es un modulo de `ExtFW`.

Su repositorio propio, si se publica por separado, sirve para:

- darle visibilidad propia en GitHub
- versionar solo el codigo del modulo
- abrir issues, releases y documentacion especifica de `noxtr`

Para usar `noxtr`, necesitas una instalacion activa de `ExtFW`.
La instalacion, ejecucion y gestion del modulo se realizan dentro del framework.

## Instalacion

Si ya tienes una web funcionando con `ExtFW`, `noxtr` se instala desde el marketplace del framework:

1. entra en `https://tuweb/marketplace`
2. localiza la fila correspondiente a `noxtr`
3. pulsa en `Instalar`

## Nota util

Copiar contactos de un user a otro:

```sql
INSERT OR REPLACE INTO NSTR_CONTACTS (user_id, pubkey, petname)
SELECT 2, origen.pubkey, origen.petname
FROM NSTR_CONTACTS AS origen
WHERE origen.user_id = 1;
```
