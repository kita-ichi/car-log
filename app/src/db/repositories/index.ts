/**
 * リポジトリ層のエントリポイント。
 * frontend-developer はここから import して使う。
 */
export {
  vehicleRepository,
  createVehicleRepository,
  type VehicleInput,
  type VehicleUpdate,
  type VehicleRepository,
  type VehiclePhotoInput,
  type PhotoAssignment,
  type PhotoAdjustAssignment,
} from './vehicleRepository'
export {
  fuelRecordRepository,
  createFuelRecordRepository,
  type FuelRecordInput,
  type FuelRecordUpdate,
  type FuelRecordRepository,
} from './fuelRecordRepository'
export {
  maintenanceRepository,
  createMaintenanceRepository,
  type MaintenanceRecordInput,
  type MaintenanceRecordUpdate,
  type MaintenanceRepository,
} from './maintenanceRepository'
export {
  settingsRepository,
  createSettingsRepository,
  type SettingsRepository,
} from './settingsRepository'
