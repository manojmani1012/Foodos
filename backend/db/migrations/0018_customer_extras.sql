-- Swiggy/Zomato-style extras chosen in the cart, each kept for the person who
-- needs it: cooking notes and "no cutlery" go to the kitchen, delivery
-- preferences ("leave at the door") go to the rider.
alter table orders add column cooking_instructions text;
alter table orders add column no_cutlery boolean not null default false;
alter table orders add column delivery_preferences text[] not null default '{}';

-- The customer's rating of the delivery itself, apart from the food review.
-- The rider's average in delivery_partners is worked out from these.
alter table deliveries add column rider_rating smallint check (rider_rating between 1 and 5);
alter table deliveries add column rider_rating_comment text;
alter table deliveries add column rider_rated_at timestamptz;
