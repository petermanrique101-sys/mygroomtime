import type {
  Prisma,
  Client,
  Pet,
  Service,
  Vehicle,
  Appointment,
  RecurringSeries,
  BookingPageRequest,
  SmsMessage,
  User,
  MutationLog,
  GoogleCalendarLink,
} from '@prisma/client';

type StripTenant<T> = Omit<T, 'tenantId' | 'tenant'>;

interface BatchPayload {
  count: number;
}

type ScopedFind<Model, ArgsFindMany, ArgsFindFirst, ArgsCount> = {
  findMany: (args?: StripTenant<ArgsFindMany>) => Promise<Model[]>;
  findFirst: (args?: StripTenant<ArgsFindFirst>) => Promise<Model | null>;
  findFirstOrThrow: (args?: StripTenant<ArgsFindFirst>) => Promise<Model>;
  count: (args?: StripTenant<ArgsCount>) => Promise<number>;
};

type ScopedWrite<
  Model,
  ArgsCreate,
  ArgsCreateMany,
  CreateInput,
  CreateManyInput,
  ArgsUpdate,
  ArgsUpdateMany,
  ArgsDelete,
  ArgsDeleteMany,
> = {
  create: (
    args: Omit<ArgsCreate, 'data'> & { data: StripTenant<CreateInput> },
  ) => Promise<Model>;
  createMany: (
    args: Omit<ArgsCreateMany, 'data'> & {
      data: StripTenant<CreateManyInput> | StripTenant<CreateManyInput>[];
    },
  ) => Promise<BatchPayload>;
  update: (args: StripTenant<ArgsUpdate>) => Promise<Model>;
  updateMany: (args: StripTenant<ArgsUpdateMany>) => Promise<BatchPayload>;
  delete: (args: StripTenant<ArgsDelete>) => Promise<Model>;
  deleteMany: (args?: StripTenant<ArgsDeleteMany>) => Promise<BatchPayload>;
};

export type ScopedClient = ScopedFind<
  Client,
  Prisma.ClientFindManyArgs,
  Prisma.ClientFindFirstArgs,
  Prisma.ClientCountArgs
> &
  ScopedWrite<
    Client,
    Prisma.ClientCreateArgs,
    Prisma.ClientCreateManyArgs,
    Prisma.ClientUncheckedCreateInput,
    Prisma.ClientCreateManyInput,
    Prisma.ClientUpdateArgs,
    Prisma.ClientUpdateManyArgs,
    Prisma.ClientDeleteArgs,
    Prisma.ClientDeleteManyArgs
  >;

export type ScopedPet = ScopedFind<
  Pet,
  Prisma.PetFindManyArgs,
  Prisma.PetFindFirstArgs,
  Prisma.PetCountArgs
> &
  ScopedWrite<
    Pet,
    Prisma.PetCreateArgs,
    Prisma.PetCreateManyArgs,
    Prisma.PetUncheckedCreateInput,
    Prisma.PetCreateManyInput,
    Prisma.PetUpdateArgs,
    Prisma.PetUpdateManyArgs,
    Prisma.PetDeleteArgs,
    Prisma.PetDeleteManyArgs
  >;

export type ScopedService = ScopedFind<
  Service,
  Prisma.ServiceFindManyArgs,
  Prisma.ServiceFindFirstArgs,
  Prisma.ServiceCountArgs
> &
  ScopedWrite<
    Service,
    Prisma.ServiceCreateArgs,
    Prisma.ServiceCreateManyArgs,
    Prisma.ServiceUncheckedCreateInput,
    Prisma.ServiceCreateManyInput,
    Prisma.ServiceUpdateArgs,
    Prisma.ServiceUpdateManyArgs,
    Prisma.ServiceDeleteArgs,
    Prisma.ServiceDeleteManyArgs
  >;

export type ScopedVehicle = ScopedFind<
  Vehicle,
  Prisma.VehicleFindManyArgs,
  Prisma.VehicleFindFirstArgs,
  Prisma.VehicleCountArgs
> &
  ScopedWrite<
    Vehicle,
    Prisma.VehicleCreateArgs,
    Prisma.VehicleCreateManyArgs,
    Prisma.VehicleUncheckedCreateInput,
    Prisma.VehicleCreateManyInput,
    Prisma.VehicleUpdateArgs,
    Prisma.VehicleUpdateManyArgs,
    Prisma.VehicleDeleteArgs,
    Prisma.VehicleDeleteManyArgs
  >;

export type ScopedAppointment = ScopedFind<
  Appointment,
  Prisma.AppointmentFindManyArgs,
  Prisma.AppointmentFindFirstArgs,
  Prisma.AppointmentCountArgs
> &
  ScopedWrite<
    Appointment,
    Prisma.AppointmentCreateArgs,
    Prisma.AppointmentCreateManyArgs,
    Prisma.AppointmentUncheckedCreateInput,
    Prisma.AppointmentCreateManyInput,
    Prisma.AppointmentUpdateArgs,
    Prisma.AppointmentUpdateManyArgs,
    Prisma.AppointmentDeleteArgs,
    Prisma.AppointmentDeleteManyArgs
  >;

export type ScopedRecurringSeries = ScopedFind<
  RecurringSeries,
  Prisma.RecurringSeriesFindManyArgs,
  Prisma.RecurringSeriesFindFirstArgs,
  Prisma.RecurringSeriesCountArgs
> &
  ScopedWrite<
    RecurringSeries,
    Prisma.RecurringSeriesCreateArgs,
    Prisma.RecurringSeriesCreateManyArgs,
    Prisma.RecurringSeriesUncheckedCreateInput,
    Prisma.RecurringSeriesCreateManyInput,
    Prisma.RecurringSeriesUpdateArgs,
    Prisma.RecurringSeriesUpdateManyArgs,
    Prisma.RecurringSeriesDeleteArgs,
    Prisma.RecurringSeriesDeleteManyArgs
  >;

export type ScopedBookingPageRequest = ScopedFind<
  BookingPageRequest,
  Prisma.BookingPageRequestFindManyArgs,
  Prisma.BookingPageRequestFindFirstArgs,
  Prisma.BookingPageRequestCountArgs
> &
  ScopedWrite<
    BookingPageRequest,
    Prisma.BookingPageRequestCreateArgs,
    Prisma.BookingPageRequestCreateManyArgs,
    Prisma.BookingPageRequestUncheckedCreateInput,
    Prisma.BookingPageRequestCreateManyInput,
    Prisma.BookingPageRequestUpdateArgs,
    Prisma.BookingPageRequestUpdateManyArgs,
    Prisma.BookingPageRequestDeleteArgs,
    Prisma.BookingPageRequestDeleteManyArgs
  >;

export type ScopedSmsMessage = ScopedFind<
  SmsMessage,
  Prisma.SmsMessageFindManyArgs,
  Prisma.SmsMessageFindFirstArgs,
  Prisma.SmsMessageCountArgs
> &
  ScopedWrite<
    SmsMessage,
    Prisma.SmsMessageCreateArgs,
    Prisma.SmsMessageCreateManyArgs,
    Prisma.SmsMessageUncheckedCreateInput,
    Prisma.SmsMessageCreateManyInput,
    Prisma.SmsMessageUpdateArgs,
    Prisma.SmsMessageUpdateManyArgs,
    Prisma.SmsMessageDeleteArgs,
    Prisma.SmsMessageDeleteManyArgs
  >;

export type ScopedUser = ScopedFind<
  User,
  Prisma.UserFindManyArgs,
  Prisma.UserFindFirstArgs,
  Prisma.UserCountArgs
> &
  ScopedWrite<
    User,
    Prisma.UserCreateArgs,
    Prisma.UserCreateManyArgs,
    Prisma.UserUncheckedCreateInput,
    Prisma.UserCreateManyInput,
    Prisma.UserUpdateArgs,
    Prisma.UserUpdateManyArgs,
    Prisma.UserDeleteArgs,
    Prisma.UserDeleteManyArgs
  >;

export type ScopedMutationLog = ScopedFind<
  MutationLog,
  Prisma.MutationLogFindManyArgs,
  Prisma.MutationLogFindFirstArgs,
  Prisma.MutationLogCountArgs
> &
  ScopedWrite<
    MutationLog,
    Prisma.MutationLogCreateArgs,
    Prisma.MutationLogCreateManyArgs,
    Prisma.MutationLogUncheckedCreateInput,
    Prisma.MutationLogCreateManyInput,
    Prisma.MutationLogUpdateArgs,
    Prisma.MutationLogUpdateManyArgs,
    Prisma.MutationLogDeleteArgs,
    Prisma.MutationLogDeleteManyArgs
  >;

export type ScopedGoogleCalendarLink = ScopedFind<
  GoogleCalendarLink,
  Prisma.GoogleCalendarLinkFindManyArgs,
  Prisma.GoogleCalendarLinkFindFirstArgs,
  Prisma.GoogleCalendarLinkCountArgs
> &
  ScopedWrite<
    GoogleCalendarLink,
    Prisma.GoogleCalendarLinkCreateArgs,
    Prisma.GoogleCalendarLinkCreateManyArgs,
    Prisma.GoogleCalendarLinkUncheckedCreateInput,
    Prisma.GoogleCalendarLinkCreateManyInput,
    Prisma.GoogleCalendarLinkUpdateArgs,
    Prisma.GoogleCalendarLinkUpdateManyArgs,
    Prisma.GoogleCalendarLinkDeleteArgs,
    Prisma.GoogleCalendarLinkDeleteManyArgs
  >;

export interface TenantScopedDb {
  readonly tenantId: string;
  client: ScopedClient;
  pet: ScopedPet;
  service: ScopedService;
  vehicle: ScopedVehicle;
  appointment: ScopedAppointment;
  recurringSeries: ScopedRecurringSeries;
  bookingPageRequest: ScopedBookingPageRequest;
  smsMessage: ScopedSmsMessage;
  user: ScopedUser;
  mutationLog: ScopedMutationLog;
  googleCalendarLink: ScopedGoogleCalendarLink;
}
