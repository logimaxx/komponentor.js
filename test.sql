 
/* Declare Parameters variables*/
 DECLARE @max_age VARCHAR(50);
 SET @max_age = '@param1';
 
/* Default Parameters setting (placeholder @param1 or @ param 1 => use 30) */
IF REPLACE(@max_age, ' ', '') = REPLACE('@param1', ' ', '')
    SET @max_age = '30';

 DECLARE @last_backup TABLE(database_name nvarchar(256),backup_finish_date datetime);
 INSERT INTO @last_backup
 SELECT database_name,max(backup_finish_date)
 FROM msdb.dbo.backupset
 WHERE type = 'D' OR type = 'I'
 GROUP BY database_name;
 
SELECT
    BK.database_name AS Channel,
    CASE ARS.role
        WHEN 2 THEN 0
        ELSE CAST(DATEDIFF(mi, MAX(backup_finish_date), GETDATE()) / 60.0 AS DECIMAL(10,2))
    END AS Value,
    '<Float>1</Float><Unit>custom</Unit><CustomUnit>hrs</CustomUnit><LimitMode>1</LimitMode><LimitMaxError>'+@max_age+'</LimitMaxError><LimitErrorMsg>Database '+BK.database_name+' is not backed up</LimitErrorMsg>' AS Channel_Settings
FROM master.sys.databases DB
LEFT JOIN @last_backup BK ON DB.name = BK.database_name
LEFT JOIN sys.dm_hadr_database_replica_states DRS ON DRS.database_id = DB.database_id AND DRS.is_local = 1
LEFT JOIN sys.dm_hadr_availability_replica_states ARS ON ARS.replica_id = DRS.replica_id
WHERE DB.state = 0 AND DB.name <> 'tempdb'
GROUP BY BK.database_name, ARS.role
 
UNION
 
SELECT
    DB.NAME AS Channel,
    CASE ARS.role
    WHEN 2 THEN 0
    ELSE 9999 
    END AS Value,
    '<Float>1</Float><Unit>custom</Unit><CustomUnit>hrs</CustomUnit><LimitMode>1</LimitMode><LimitMaxError>'+@max_age+'</LimitMaxError><LimitErrorMsg>Database '+DB.name+' is not backed up</LimitErrorMsg>' as Channel_Settings
 FROM
    master.sys.databases DB
 LEFT JOIN @last_backup BK ON DB.name = BK.database_name
 LEFT JOIN sys.dm_hadr_database_replica_states DRS ON DRS.database_id = DB.database_id AND DRS.is_local = 1
 LEFT JOIN sys.dm_hadr_availability_replica_states ARS ON ARS.replica_id = DRS.replica_id
WHERE DB.state = 0 AND BK.database_name IS NULL AND DB.name <> 'tempdb'
ORDER BY Channel
