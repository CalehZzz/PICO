# Prompt para el chat del Inventario (PICOInventory)

Copia y pega esto en el chat del inventario:

---

En la pestaña **Créditos** del inventario, necesito poder administrar el uso de créditos de una cuenta (por correo), no solo otorgarlos.

## Qué agregar en cada cuenta de `creditos/{email}`

Acciones por cuenta en la lista:

1. **Congelar / Pausar uso**  
   - Marca la cuenta para que **no pueda gastar** créditos en la tienda, pero **conserva el saldo**.  
   - Campos sugeridos: `congelado: true` (y opcional `estado: 'congelado'`).  
   - Al descongelar: `congelado: false` (o quitar el flag / `estado: 'activo'`).

2. **Bloquear / Desactivar uso** (equivalente a “eliminar el uso”)  
   - Igual que congelar a efectos de la tienda: **no se pueden usar**.  
   - Usa `bloqueado: true` y/o `activo: false` / `usoPermitido: false`.  
   - El saldo puede quedarse visible para auditoría.

3. **Quitar / poner saldo en cero**  
   - Acción explícita “Poner saldo en $0” (con confirmación).  
   - Actualiza `saldo: 0` y agrega un movimiento en `movimientos` tipo `ajuste` o `quita` con nota (quién/por qué) y `at: Date.now()`.  
   - **No borres** el documento de la cuenta (para historial / `costoInvertido` / proyecto).

## UI sugerida

En cada card de la lista de créditos, botones:

- `❄️ Congelar` / `▶️ Reactivar` (según estado)
- `🚫 Bloquear uso` (si querés distinguirlo de congelar; si no, con congelar basta)
- `🗑️ Quitar saldo` (pone saldo en 0, no borra la cuenta)

Mostrar badge de estado: `Activo` · `Congelado` · `Bloqueado` · `Vencido`.

## Contrato con la tienda (ya listo en PICO store)

La tienda **ya respeta** estos flags al calcular saldo usable y al aplicar créditos en Cloud Functions:

- `congelado === true`
- `bloqueado === true`
- `activo === false`
- `usoPermitido === false`
- `estado` en `'congelado'` o `'bloqueado'`

Si alguno aplica → saldo usable = 0 y `aplicarCreditosAPedido` rechaza el uso.

## Notas

- PIN de créditos se mantiene como está.
- No hace falta tocar la tienda para esto: solo inventario + campos en Firestore.
- Al congelar/bloquear, registra un movimiento `{ tipo: 'congelar'|'descongelar'|'bloquear'|'ajuste', at, nota }` para auditoría.

---
