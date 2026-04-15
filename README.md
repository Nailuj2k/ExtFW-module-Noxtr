
# Copiar contactos de un user a otro:

INSERT OR REPLACE INTO NSTR_CONTACTS (user_id, pubkey, petname) 
SELECT 2, origen.pubkey, origen.petname 
FROM NSTR_CONTACTS AS origen 
WHERE origen.user_id = 1